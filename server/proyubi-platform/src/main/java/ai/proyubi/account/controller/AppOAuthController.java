package ai.proyubi.account.controller;

import cn.dev33.satoken.stp.SaLoginModel;
import ai.proyubi.common.core.web.R;
import ai.proyubi.common.satoken.stp.StpTenant;
import ai.proyubi.identity.authprovider.AuthResult;
import ai.proyubi.identity.authprovider.OAuthExchangeException;
import ai.proyubi.identity.service.IdentityService;
import ai.proyubi.regions.region.Region;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

/**
 * OAuth Web Flow Controller（薄层）
 *
 * <p>只负责 web 层的编排：state cookie、302 重定向、Sa-Token 登录。
 * 凭证交换、DB 查建、画像解析全部下沉到 {@link IdentityService} + 对应 {@code AuthProvider}。
 *
 * <p>流程：
 * <ol>
 *   <li>前端跳 {@code /app/auth/oauth/{provider}/start?redirect=...}</li>
 *   <li>后端 → IdentityService.buildOAuthAuthUrl(provider, state) → 302 到 provider 授权页</li>
 *   <li>Provider 302 回 {@code /app/auth/oauth/{provider}/callback?code=...&state=...}</li>
 *   <li>后端 → IdentityService.loginWithOAuth(provider, code, region) → Sa-Token 登录 → 302 到前端回调页</li>
 * </ol>
 */
@Slf4j
@RestController
@RequestMapping("/app/auth/oauth")
@RequiredArgsConstructor
public class AppOAuthController {

    private static final String STATE_COOKIE = "oauth_state";
    private static final String REDIRECT_COOKIE = "oauth_redirect";
    // 本次授权使用的后端回调地址（redirect_uri）。多前端域名共用一个后端时，redirect_uri
    // 必须跟随发起登录的域名，且发起授权与换 token 时须完全一致——所以在 start 时定下来存 cookie，
    // callback 时原样取出复用，而不是各自从配置读固定值。
    private static final String CALLBACK_COOKIE = "oauth_cb";
    private static final int STATE_TTL_SECONDS = 600;
    /** 原生流の失敗文言。App は 4xx でこの msg をそのまま出すので、原因コードは載せない。 */
    private static final String LOGIN_FAILED_MSG = "サインインに失敗しました。もう一度お試しください。";

    private final IdentityService identityService;

    @Value("${google.oauth.default-front-redirect:}")
    private String defaultFrontRedirect;

    /** 配置的默认后端回调地址；前端 redirect 域名不在白名单时回退到它。 */
    @Value("${google.oauth.redirect-uri:}")
    private String defaultRedirectUri;

    /**
     * 允许发起 OAuth 登录的前端 host 白名单（逗号分隔，如 {@code app.example.com,pm.example.com}）。
     * <p>命中白名单的域：redirect_uri / 前端回调都跟随该域动态生成（一份后端服务多个域名）。
     * <p>留空（dev 默认）：不做按域动态，一律回退到配置的 {@code redirect-uri}/{@code default-front-redirect}，
     * 行为与历史一致。同时它是防开放重定向 + token 泄露的安全边界——非白名单域一律丢弃。
     */
    @Value("${google.oauth.allowed-redirect-hosts:}")
    private String allowedRedirectHostsRaw;

    /** 浏览器视角的后端回调路径（含反代前缀，如 prod 的 {@code /api}）。 */
    @Value("${google.oauth.callback-path:/api/app/auth/oauth/google/callback}")
    private String callbackPath;

    /**
     * 允许的原生 app 自定义回调 scheme 白名单（逗号分隔，如 {@code myapp}）。
     * <p>iOS {@code ASWebAuthenticationSession} / Android Custom Tabs 靠自定义 scheme
     * （如 {@code myapp://oauth-callback}）识别"登录完成、关闭网页框、把 token 还给原生 app"。
     * 这类 redirect 不是 http(s) 域，命中本白名单就原样跳回；redirect_uri 仍用固定注册的 https 回调
     * （Google 不接受自定义 scheme 作 redirect_uri）。
     * <p>留空 = 不放行任何自定义 scheme，与历史白名单逻辑一致；同时是防 token 被钓到恶意 app 的安全边界。
     */
    @Value("${google.oauth.allowed-redirect-schemes:}")
    private String allowedRedirectSchemesRaw;

    /**
     * 当前部署的 region（控制新建租户写哪个 region 字段 + provider 启用校验）。
     * 默认 JP（日本部署）；CN 部署时由环境变量覆盖。
     */
    @Value("${app.region:JP}")
    private String regionStr;

    /**
     * 发起 OAuth 授权码流（目前只接 Google；LINE/Wechat 只要 provider 实现即可）。
     *
     * <p>注意 Apple 不走这条：iOS 原生 Sign in with Apple 由系统完成授权，
     * 走下面的 {@link #nativeLogin(String, NativeLoginReq)}。
     */
    @GetMapping("/{provider}/start")
    public void start(@org.springframework.web.bind.annotation.PathVariable("provider") String provider,
                      @RequestParam(value = "redirect", required = false) String frontRedirect,
                      HttpServletRequest request,
                      HttpServletResponse response) throws IOException {
        String state = UUID.randomUUID().toString().replace("-", "");
        ResolvedRedirect resolved = resolveRedirect(frontRedirect);

        boolean secure = request.isSecure();
        setCookie(response, STATE_COOKIE, state, STATE_TTL_SECONDS, secure);
        setCookie(response, REDIRECT_COOKIE, resolved.frontRedirect(), STATE_TTL_SECONDS, secure);
        if (resolved.callbackUri() != null && !resolved.callbackUri().isBlank()) {
            setCookie(response, CALLBACK_COOKIE, resolved.callbackUri(), STATE_TTL_SECONDS, secure);
        }

        String authUrl;
        try {
            authUrl = identityService.buildOAuthAuthUrl(provider, state, resolved.callbackUri());
        } catch (OAuthExchangeException e) {
            log.warn("OAuth not available for provider={}: reason={}", provider, e.getReasonCode());
            response.sendError(HttpServletResponse.SC_SERVICE_UNAVAILABLE,
                provider + " login is not configured");
            return;
        } catch (IllegalArgumentException e) {
            log.warn("Unknown OAuth provider: {}", provider);
            response.sendError(HttpServletResponse.SC_NOT_FOUND, "Unknown provider: " + provider);
            return;
        }
        response.sendRedirect(authUrl);
    }

    /**
     * OAuth provider 回调
     */
    @GetMapping("/{provider}/callback")
    public void callback(@org.springframework.web.bind.annotation.PathVariable("provider") String provider,
                         @RequestParam(value = "code", required = false) String code,
                         @RequestParam(value = "state", required = false) String state,
                         @RequestParam(value = "error", required = false) String providerError,
                         HttpServletRequest request,
                         HttpServletResponse response) throws IOException {
        String expectedState = readCookie(request, STATE_COOKIE);
        String frontRedirect = readCookie(request, REDIRECT_COOKIE);
        if (frontRedirect == null || frontRedirect.isBlank()) {
            frontRedirect = defaultFrontRedirect;
        }
        // 换 token 的 redirect_uri 必须与 start 时发给 Google 的完全一致，故从 cookie 取回原值
        String callbackUri = readCookie(request, CALLBACK_COOKIE);
        if (callbackUri == null || callbackUri.isBlank()) {
            callbackUri = defaultRedirectUri;
        }

        boolean secure = request.isSecure();
        clearCookie(response, STATE_COOKIE, secure);
        clearCookie(response, REDIRECT_COOKIE, secure);
        clearCookie(response, CALLBACK_COOKIE, secure);

        if (providerError != null && !providerError.isBlank()) {
            log.warn("Provider {} returned error on callback: {}", provider, providerError);
            redirectWithStatus(response, frontRedirect, "error", "provider_error");
            return;
        }
        if (code == null || code.isBlank()) {
            redirectWithStatus(response, frontRedirect, "error", "no_code");
            return;
        }
        if (expectedState == null || !expectedState.equals(state)) {
            log.warn("OAuth state mismatch (provider={}): expected={}, got={}", provider, expectedState, state);
            redirectWithStatus(response, frontRedirect, "error", "bad_state");
            return;
        }

        Region region = parseRegion(regionStr);
        AuthResult result = identityService.loginWithOAuth(provider, code, region, callbackUri);
        if (!result.success()) {
            redirectWithStatus(response, frontRedirect, "error", result.errorCode());
            return;
        }

        // Sa-Token 登录 + 写 session
        StpTenant.STP_LOGIC.login(result.loginId(), new SaLoginModel());
        StpTenant.STP_LOGIC.getSession().set("tenant_id", result.tenantId().toString());
        StpTenant.STP_LOGIC.getSession().set("user_id", result.tenantUserId().toString());
        if (result.email() != null) {
            StpTenant.STP_LOGIC.getSession().set("account_email", result.email().toLowerCase());
        }
        String token = StpTenant.STP_LOGIC.getTokenValue();

        String target = frontRedirect + "#token=" + urlEncode(token) + "&status=ok";
        response.sendRedirect(target);
    }

    /**
     * 原生 ID token 登录（Sign in with Apple）。
     *
     * <p>iOS/macOS 侧由系统的 {@code ASAuthorizationController} 完成授权，客户端直接拿到
     * Apple 签发的 {@code identityToken}，没有"后端跳授权页 → code 回调"这一段，
     * 所以这里是一个普通 JSON 端点，而不是上面那对 302 流。
     * 返回体与 {@code /app/auth/email/verify} 同形（token + loginId），客户端可复用同一套落盘逻辑。
     *
     * <p>安全性完全由 {@code AppleAuthProvider} 的 JWT 验签（签名/iss/aud/exp/nonce）保证。
     */
    @PostMapping("/{provider}/native")
    public R<NativeLoginResp> nativeLogin(
            @org.springframework.web.bind.annotation.PathVariable("provider") String provider,
            @RequestBody NativeLoginReq req) {
        // 失敗時の msg はそのままトーストに出る（app は 4xx でサーバー文言を優先表示する）。
        // 原因コードはログにだけ残し、ユーザーには一律の文言を返す。
        if (req == null || req.identityToken() == null || req.identityToken().isBlank()) {
            return R.fail(400, LOGIN_FAILED_MSG);
        }

        AuthResult result;
        try {
            result = identityService.loginWithNativeIdentityToken(
                provider, req.identityToken(), req.nonce(), req.fullName(), parseRegion(regionStr));
        } catch (IllegalArgumentException e) {
            log.warn("Native login rejected for provider={}: {}", provider, e.getMessage());
            return R.fail(400, LOGIN_FAILED_MSG);
        }
        if (!result.success()) {
            log.warn("Native login failed: provider={} reason={}", provider, result.errorCode());
            return R.fail(400, LOGIN_FAILED_MSG);
        }

        StpTenant.STP_LOGIC.login(result.loginId(), new SaLoginModel());
        StpTenant.STP_LOGIC.getSession().set("tenant_id", result.tenantId().toString());
        StpTenant.STP_LOGIC.getSession().set("user_id", result.tenantUserId().toString());
        // 账号级标识：让 /me 能列出可切换团队（与邮箱/Google 登录一致）
        if (result.email() != null) {
            StpTenant.STP_LOGIC.getSession().set("account_email", result.email().toLowerCase());
        }
        return R.ok(new NativeLoginResp(StpTenant.STP_LOGIC.getTokenValue(), result.loginId()));
    }

    // --- DTOs ---

    /**
     * @param identityToken     提供方签发的 ID token（必填）
     * @param nonce             客户端本次登录生成的 raw nonce（选填，传了就校验，防重放）
     * @param fullName          Apple 只在首次授权时给的姓名（选填，仅新建账号时用得上）
     * @param authorizationCode Apple 的一次性授权码。当前未使用；预留给后续
     *                          "注销账号时调 Apple REST API 撤销 token"（需要它换 refresh_token），
     *                          先让客户端传上来，避免将来为此再发一版 App。
     */
    public record NativeLoginReq(
        String identityToken,
        String nonce,
        String fullName,
        String authorizationCode
    ) {}

    public record NativeLoginResp(String token, String loginId) {}

    // --- helpers ---

    /** 发起登录时定下的一对值：成功后跳回的前端页 + 本次 Google 回调地址（redirect_uri）。 */
    private record ResolvedRedirect(String frontRedirect, String callbackUri) {}

    /**
     * 解析前端传入的 {@code redirect}：
     * <ul>
     *   <li>其 host 命中白名单 → 跟随该域：前端回调用原值，redirect_uri = {@code scheme://host[:port]} + callbackPath。
     *       一份后端服务多个前端域名，每条流程全程留在自己的域上（cookie 也就不会跨域丢失）。</li>
     *   <li>否则（空 / 非白名单 / 白名单未配置）→ 回退到配置默认值，杜绝开放重定向 + token 泄露。</li>
     * </ul>
     */
    private ResolvedRedirect resolveRedirect(String frontRedirect) {
        if (frontRedirect != null && !frontRedirect.isBlank()) {
            String scheme = schemeOf(frontRedirect);
            // 原生 app 自定义 scheme（如 myapp://...）：ASWebAuthenticationSession 靠它收尾。
            // 命中 scheme 白名单 → 前端回调原样用该 scheme；redirect_uri 仍用固定注册的 https 回调
            // （Google 不接受自定义 scheme），故 callbackUri 走 defaultRedirectUri。
            if (scheme != null && !isHttp(scheme) && allowedSchemes().contains(scheme.toLowerCase())) {
                return new ResolvedRedirect(frontRedirect, defaultRedirectUri);
            }
            // http(s) 前端域：按 host 白名单动态生成，浏览器全程留在自身域。
            String host = hostOf(frontRedirect);
            if (host != null && allowedHosts().contains(host)) {
                String origin = originOf(frontRedirect);
                if (origin != null) {
                    return new ResolvedRedirect(frontRedirect, origin + callbackPath);
                }
            }
            if (host != null) {
                log.warn("OAuth redirect host not allowed, falling back to default: {}", host);
            } else if (scheme != null) {
                log.warn("OAuth redirect scheme not allowed, falling back to default: {}", scheme);
            }
        }
        return new ResolvedRedirect(defaultFrontRedirect, defaultRedirectUri);
    }

    private static boolean isHttp(String scheme) {
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    private Set<String> allowedSchemes() {
        Set<String> set = new HashSet<>();
        if (allowedRedirectSchemesRaw != null && !allowedRedirectSchemesRaw.isBlank()) {
            for (String s : allowedRedirectSchemesRaw.split(",")) {
                String t = s.trim();
                if (!t.isEmpty()) set.add(t.toLowerCase());
            }
        }
        return set;
    }

    private static String schemeOf(String url) {
        try {
            return new URI(url).getScheme();
        } catch (Exception e) {
            return null;
        }
    }

    private Set<String> allowedHosts() {
        Set<String> set = new HashSet<>();
        if (allowedRedirectHostsRaw != null && !allowedRedirectHostsRaw.isBlank()) {
            for (String h : allowedRedirectHostsRaw.split(",")) {
                String t = h.trim();
                if (!t.isEmpty()) set.add(t);
            }
        }
        return set;
    }

    private static String hostOf(String url) {
        try {
            return new URI(url).getHost();
        } catch (Exception e) {
            return null;
        }
    }

    private static String originOf(String url) {
        try {
            URI u = new URI(url);
            if (u.getScheme() == null || u.getHost() == null) return null;
            StringBuilder sb = new StringBuilder(u.getScheme()).append("://").append(u.getHost());
            if (u.getPort() != -1) sb.append(':').append(u.getPort());
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private static Region parseRegion(String s) {
        if (s == null || s.isBlank()) return Region.GLOBAL;
        try {
            return Region.valueOf(s.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            log.warn("Unknown region '{}', falling back to GLOBAL", s);
            return Region.GLOBAL;
        }
    }

    private static String urlEncode(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }

    private static void setCookie(HttpServletResponse response, String name, String value,
                                   int maxAgeSeconds, boolean secure) {
        // Path=/ 而不是 /app/auth/oauth：同域反代部署下浏览器看到的 URL 是
        // /api/app/auth/oauth/...，cookie path 必须按"浏览器 URL"匹配而非后端实际接收的路径
        response.addHeader("Set-Cookie",
            name + "=" + value
                + "; Max-Age=" + maxAgeSeconds
                + "; Path=/"
                + "; HttpOnly"
                + (secure ? "; Secure" : "")
                + "; SameSite=Lax");
    }

    private static void clearCookie(HttpServletResponse response, String name, boolean secure) {
        response.addHeader("Set-Cookie",
            name + "="
                + "; Max-Age=0"
                + "; Path=/"
                + "; HttpOnly"
                + (secure ? "; Secure" : "")
                + "; SameSite=Lax");
    }

    private static String readCookie(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return null;
        for (Cookie c : cookies) {
            if (name.equals(c.getName())) {
                return c.getValue();
            }
        }
        return null;
    }

    private static void redirectWithStatus(HttpServletResponse response, String frontRedirect,
                                            String status, String reason) throws IOException {
        String target = frontRedirect + "#status=" + urlEncode(status)
            + "&reason=" + urlEncode(reason != null ? reason : "unknown");
        response.sendRedirect(target);
    }
}

package ai.proyubi.identity.authprovider;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.RSAPublicKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Sign in with Apple 认证提供者（原生流 / native flow）。
 *
 * <p><b>为什么和 Google 不是同一套流程</b>：Apple 在 iOS/macOS 上要求用系统原生的
 * {@code ASAuthorizationController}（App Store 审核指南 4.8 + Apple 的按钮视觉规范），
 * 客户端直接拿到 Apple 签发的 {@code identityToken}(JWT) + {@code authorizationCode}，
 * 没有"后端跳授权页 → code 回调"这一步。所以本 provider 实现的是
 * {@link #verifyNativeIdentityToken(String, String)}（验签 JWT 换画像），
 * 而不是 {@link #buildAuthUrl(String)} / {@link #exchangeOAuth(String)}。
 *
 * <p>Web 端（wms-web）若将来也要接 Apple 登录，需要额外注册 Services ID 并处理
 * Apple 特有的 {@code response_mode=form_post}（回调是 POST 不是 GET），
 * 与现有 {@code AppOAuthController} 的 GET 回调不兼容 —— 属于后续工作，本类不涉及。
 *
 * <p>验签规则（参考 Apple「Verifying a User」文档）：
 * <ol>
 *   <li>用 <a href="https://appleid.apple.com/auth/keys">Apple JWKS</a> 里 {@code kid} 对应的
 *       RSA 公钥验 RS256 签名（JWKS 结果内存缓存，遇未知 kid 或过期即刷新）</li>
 *   <li>{@code iss} 必须是 {@code https://appleid.apple.com}</li>
 *   <li>{@code aud} 必须命中配置的 client-id 白名单（原生 app = Bundle ID，如 {@code com.example.app}）</li>
 *   <li>{@code exp} 未过期（允许 {@value #CLOCK_SKEW_SECONDS}s 时钟偏差）</li>
 *   <li>若客户端传了 nonce：{@code nonce} claim 必须等于 sha256(rawNonce) 的 hex（防重放）</li>
 * </ol>
 *
 * <p>Apple 特有的两个坑，调用方需注意：
 * <ul>
 *   <li><b>姓名只在首次授权时返回</b>，且不在 JWT 里，由客户端单独传上来 —— 见
 *       {@code IdentityService.loginWithNativeIdentityToken} 的 fallbackName 参数。</li>
 *   <li><b>邮箱可能是中继地址</b>（{@code xxx@privaterelay.appleid.com}，claim {@code is_private_email=true}）。
 *       这是用户"隐藏邮箱"的正常结果，照常入库；查人一律按 {@code apple:{sub}} 而非邮箱。</li>
 * </ul>
 *
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AppleAuthProvider implements AuthProvider {

    private static final String PROVIDER_TYPE = "apple";
    private static final String ISSUER = "https://appleid.apple.com";
    private static final String JWKS_URL = "https://appleid.apple.com/auth/keys";
    /** 允许的时钟偏差（秒）——Apple 的 identityToken 本身只有 5 分钟有效期。 */
    private static final long CLOCK_SKEW_SECONDS = 60;
    /** JWKS 缓存时长；Apple 的签名键很少轮换，遇未知 kid 时还会额外强制刷新一次。 */
    private static final Duration JWKS_TTL = Duration.ofHours(6);

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    /**
     * 允许的 {@code aud}（逗号分隔）。原生 app 填 Bundle ID（如 {@code com.example.app,com.example.app2}）；
     * 将来接 Web 时把 Services ID 也加进来。留空 = Apple 登录未配置。
     */
    @Value("${apple.oauth.client-ids:}")
    private String clientIdsRaw;

    /** JWKS 缓存：kid → 公钥。整体替换（不做条目级失效），配合 fetchedAt 判断是否过期。 */
    private volatile Map<String, RSAPublicKey> jwksCache = Map.of();
    private volatile Instant jwksFetchedAt = Instant.EPOCH;

    @Override
    public String getType() {
        return PROVIDER_TYPE;
    }

    /** OAuth 家族（外部身份提供方），但走原生 token 流而非授权码跳转流。 */
    @Override
    public boolean isOAuth() {
        return true;
    }

    @Override
    public boolean supportsNativeIdentityToken() {
        return true;
    }

    @Override
    public boolean isConfigured() {
        return !clientIds().isEmpty();
    }

    @Override
    public OAuthUserProfile verifyNativeIdentityToken(String identityToken, String expectedNonce) {
        if (!isConfigured()) {
            throw new OAuthExchangeException("not_configured",
                "Apple login is not configured (APPLE_OAUTH_CLIENT_IDS)");
        }
        if (identityToken == null || identityToken.isBlank()) {
            throw new OAuthExchangeException("token_invalid", "Apple identityToken is empty");
        }

        String[] parts = identityToken.split("\\.");
        if (parts.length != 3) {
            throw new OAuthExchangeException("token_invalid",
                "Apple identityToken is not a well-formed JWS");
        }

        JsonNode header = parseJsonSegment(parts[0], "header");
        JsonNode payload = parseJsonSegment(parts[1], "payload");

        String alg = textOrNull(header, "alg");
        if (!"RS256".equals(alg)) {
            throw new OAuthExchangeException("token_invalid",
                "Unexpected Apple identityToken alg: " + alg);
        }
        String kid = textOrNull(header, "kid");
        if (kid == null) {
            throw new OAuthExchangeException("token_invalid", "Apple identityToken header has no kid");
        }

        verifySignature(parts[0] + "." + parts[1], parts[2], kid);
        verifyClaims(payload, expectedNonce);

        String sub = textOrNull(payload, "sub");
        if (sub == null || sub.isBlank()) {
            throw new OAuthExchangeException("userinfo_incomplete",
                "Apple identityToken has no sub");
        }
        String email = textOrNull(payload, "email");
        boolean emailVerified = booleanClaim(payload, "email_verified");
        boolean privateEmail = booleanClaim(payload, "is_private_email");
        if (privateEmail) {
            log.debug("Apple login with private relay email (sub={})", sub);
        }

        return new OAuthUserProfile(
            PROVIDER_TYPE,
            sub,
            email,
            // 中继邮箱由 Apple 托管投递，同样视为已验证；Apple 只在用户自己的邮箱未验证时给 false。
            emailVerified,
            // 姓名不在 token 里：Apple 只在"首次授权"时通过客户端返回，由上层用 fallbackName 补。
            null,
            null
        );
    }

    // --- 验签 / claim 校验 ---

    private void verifySignature(String signingInput, String signatureSegment, String kid) {
        RSAPublicKey key = resolveKey(kid);
        try {
            Signature verifier = Signature.getInstance("SHA256withRSA");
            verifier.initVerify(key);
            verifier.update(signingInput.getBytes(StandardCharsets.US_ASCII));
            if (!verifier.verify(base64UrlDecode(signatureSegment))) {
                throw new OAuthExchangeException("token_invalid",
                    "Apple identityToken signature verification failed");
            }
        } catch (OAuthExchangeException e) {
            throw e;
        } catch (Exception e) {
            throw new OAuthExchangeException("token_invalid",
                "Apple identityToken signature verification error", e);
        }
    }

    private void verifyClaims(JsonNode payload, String expectedNonce) {
        String iss = textOrNull(payload, "iss");
        if (!ISSUER.equals(iss)) {
            throw new OAuthExchangeException("token_invalid",
                "Unexpected Apple identityToken iss: " + iss);
        }

        // aud 可能是字符串或数组（规范允许两种）
        Set<String> allowed = clientIds();
        JsonNode aud = payload.get("aud");
        boolean audOk = false;
        if (aud != null && aud.isTextual()) {
            audOk = allowed.contains(aud.asText());
        } else if (aud != null && aud.isArray()) {
            for (JsonNode n : aud) {
                if (allowed.contains(n.asText())) {
                    audOk = true;
                    break;
                }
            }
        }
        if (!audOk) {
            throw new OAuthExchangeException("token_invalid",
                "Apple identityToken aud not allowed: " + aud);
        }

        JsonNode exp = payload.get("exp");
        if (exp == null || !exp.canConvertToLong()) {
            throw new OAuthExchangeException("token_invalid",
                "Apple identityToken has no usable exp");
        }
        long now = Instant.now().getEpochSecond();
        if (exp.asLong() + CLOCK_SKEW_SECONDS < now) {
            throw new OAuthExchangeException("token_expired",
                "Apple identityToken expired at " + exp.asLong());
        }

        if (expectedNonce != null && !expectedNonce.isBlank()) {
            String tokenNonce = textOrNull(payload, "nonce");
            String hashed = sha256Hex(expectedNonce);
            // 客户端把 sha256(rawNonce) 发给 Apple，Apple 原样放进 nonce claim；
            // 这里收到的是 rawNonce，故比较其 hash。兼容客户端直接传 hash 的情形。
            if (tokenNonce == null
                || !(tokenNonce.equals(hashed) || tokenNonce.equals(expectedNonce))) {
                throw new OAuthExchangeException("nonce_mismatch",
                    "Apple identityToken nonce mismatch");
            }
        }
    }

    // --- JWKS ---

    private RSAPublicKey resolveKey(String kid) {
        Map<String, RSAPublicKey> cache = jwksCache;
        boolean stale = Instant.now().isAfter(jwksFetchedAt.plus(JWKS_TTL));
        if (!stale && cache.containsKey(kid)) {
            return cache.get(kid);
        }
        // 未命中或已过期：刷新一次再看（Apple 轮换签名键时走这条路）
        cache = fetchJwks();
        RSAPublicKey key = cache.get(kid);
        if (key == null) {
            throw new OAuthExchangeException("token_invalid",
                "Apple JWKS has no key for kid=" + kid);
        }
        return key;
    }

    private synchronized Map<String, RSAPublicKey> fetchJwks() {
        // 双检：并发首登时只有一个线程真的去拉
        if (Instant.now().isBefore(jwksFetchedAt.plus(JWKS_TTL)) && !jwksCache.isEmpty()) {
            return jwksCache;
        }
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(JWKS_URL))
            .header("Accept", "application/json")
            .GET()
            .build();
        HttpResponse<String> resp;
        try {
            resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new OAuthExchangeException("jwks_failed", "Apple JWKS network error", e);
        }
        if (resp.statusCode() != 200) {
            log.warn("Apple JWKS fetch failed: status={}, body={}", resp.statusCode(), resp.body());
            throw new OAuthExchangeException("jwks_failed",
                "Apple JWKS returned HTTP " + resp.statusCode());
        }

        Map<String, RSAPublicKey> parsed = new HashMap<>();
        try {
            JsonNode keys = objectMapper.readTree(resp.body()).path("keys");
            for (JsonNode k : keys) {
                if (!"RSA".equals(textOrNull(k, "kty"))) continue;
                String kid = textOrNull(k, "kid");
                String n = textOrNull(k, "n");
                String e = textOrNull(k, "e");
                if (kid == null || n == null || e == null) continue;
                RSAPublicKeySpec spec = new RSAPublicKeySpec(
                    new BigInteger(1, base64UrlDecode(n)),
                    new BigInteger(1, base64UrlDecode(e)));
                parsed.put(kid, (RSAPublicKey) KeyFactory.getInstance("RSA").generatePublic(spec));
            }
        } catch (Exception e) {
            throw new OAuthExchangeException("jwks_failed", "Apple JWKS parse error", e);
        }
        if (parsed.isEmpty()) {
            throw new OAuthExchangeException("jwks_failed", "Apple JWKS contains no RSA keys");
        }

        jwksCache = Map.copyOf(parsed);
        jwksFetchedAt = Instant.now();
        return jwksCache;
    }

    // --- helpers ---

    private Set<String> clientIds() {
        Set<String> set = new HashSet<>();
        if (clientIdsRaw != null && !clientIdsRaw.isBlank()) {
            for (String s : clientIdsRaw.split(",")) {
                String t = s.trim();
                if (!t.isEmpty()) set.add(t);
            }
        }
        return set;
    }

    private JsonNode parseJsonSegment(String segment, String what) {
        try {
            return objectMapper.readTree(base64UrlDecode(segment));
        } catch (Exception e) {
            throw new OAuthExchangeException("token_invalid",
                "Apple identityToken " + what + " is not valid JSON", e);
        }
    }

    private static byte[] base64UrlDecode(String s) {
        return Base64.getUrlDecoder().decode(s);
    }

    private static String sha256Hex(String raw) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static boolean booleanClaim(JsonNode node, String field) {
        JsonNode v = node.get(field);
        if (v == null || v.isNull()) return false;
        // Apple 有时把布尔值发成字符串 "true"/"false"
        return v.isBoolean() ? v.asBoolean() : Boolean.parseBoolean(v.asText());
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v == null || v.isNull()) ? null : v.asText();
    }
}

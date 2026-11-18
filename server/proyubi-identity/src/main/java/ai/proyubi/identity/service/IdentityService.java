package ai.proyubi.identity.service;

import ai.proyubi.identity.accountmodel.AccountModel;
import ai.proyubi.identity.accountmodel.CreatedAccount;
import ai.proyubi.identity.authprovider.AuthProvider;
import ai.proyubi.identity.authprovider.AuthResult;
import ai.proyubi.identity.authprovider.OAuthExchangeException;
import ai.proyubi.identity.authprovider.OAuthUserProfile;
import ai.proyubi.identity.mapper.IdentityMapper;
import ai.proyubi.regions.region.Region;
import ai.proyubi.regions.region.RegionProfile;
import ai.proyubi.regions.service.RegionProfileService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 身份认证服务
 *
 * <p>职责：
 * <ul>
 *   <li>把 AuthProvider / AccountModel / RegionProfile 编排起来</li>
 *   <li>对外暴露高层入口：{@link #buildOAuthAuthUrl(String, String)} / {@link #loginWithOAuth(String, String, Region)}</li>
 *   <li>校验"当前 region 是否启用该 provider"（让 regions/*.yaml 真正起作用）</li>
 * </ul>
 *
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class IdentityService {

    private final List<AuthProvider> authProviders;
    private final List<AccountModel> accountModels;
    private final IdentityMapper identityMapper;
    private final RegionProfileService regionProfileService;

    // --- 密码流（保留，v0.6 实现）---

    public AuthResult authenticate(String providerType, String identifier, String credential) {
        AuthProvider provider = resolveProvider(providerType);
        return provider.authenticate(identifier, credential);
    }

    // --- OAuth 流 ---

    /**
     * 构造 OAuth 授权页 URL（controller 会 302 用户过去）。
     *
     * @param providerType google / line 等
     * @param state        由 controller 生成并存 cookie 的随机字符串
     */
    public String buildOAuthAuthUrl(String providerType, String state) {
        return buildOAuthAuthUrl(providerType, state, null);
    }

    /**
     * 构造 OAuth 授权页 URL，并显式指定本次回调地址（redirect_uri）。
     *
     * <p>多前端域名共用一个后端时，{@code redirectUri} 跟随发起登录的域名传入；
     * null/空则回退到 provider 配置默认值。该值须与 {@link #loginWithOAuth(String, String, Region, String)}
     * 换 token 时使用的 redirect_uri 完全一致。
     */
    public String buildOAuthAuthUrl(String providerType, String state, String redirectUri) {
        AuthProvider provider = resolveProvider(providerType);
        if (!provider.isOAuth()) {
            throw new IllegalArgumentException(providerType + " provider is not OAuth");
        }
        if (!provider.isConfigured()) {
            throw new OAuthExchangeException("not_configured",
                providerType + " provider is not configured");
        }
        return provider.buildAuthUrl(state, redirectUri);
    }

    /**
     * OAuth 回调处理：code → 用户画像 → find-or-create → 返回 AuthResult。
     *
     * <p>成功返回的 AuthResult 里 tenantId / tenantUserId / loginId 都已填充，
     * controller 直接调 Sa-Token 登录即可。
     *
     * @param providerType 提供方（google/line 等）
     * @param code         授权码
     * @param region       当前区域（用于校验该 provider 是否启用 + 新建租户时写 region 字段）
     */
    public AuthResult loginWithOAuth(String providerType, String code, Region region) {
        return loginWithOAuth(providerType, code, region, null);
    }

    /**
     * OAuth 回调处理，并显式指定换 token 时的 redirect_uri（必须与发起授权时一致）。
     *
     * @param redirectUri 本次回调地址；null/空回退到 provider 配置默认值
     * @see #loginWithOAuth(String, String, Region)
     */
    public AuthResult loginWithOAuth(String providerType, String code, Region region, String redirectUri) {
        assertProviderEnabledInRegion(providerType, region);

        AuthProvider provider = resolveProvider(providerType);
        if (!provider.isOAuth()) {
            throw new IllegalArgumentException(providerType + " provider is not OAuth");
        }

        OAuthUserProfile profile;
        try {
            profile = provider.exchangeOAuth(code, redirectUri);
        } catch (OAuthExchangeException e) {
            log.warn("OAuth exchange failed: provider={} reason={} msg={}",
                providerType, e.getReasonCode(), e.getMessage());
            return AuthResult.failure(e.getReasonCode());
        }

        return resolveOrCreateAccount(profile, region);
    }

    /**
     * 原生 ID token 登录（Sign in with Apple）：验签 → 用户画像 → find-or-create → AuthResult。
     *
     * <p>与 {@link #loginWithOAuth(String, String, Region)} 的差别只在"怎么拿到画像"：
     * 这里客户端已在系统层完成授权，后端只验 JWT，没有跳转与 code 交换。
     * 拿到画像之后的查/建账号、跨 provider 邮箱合并逻辑完全共用。
     *
     * @param providerType  提供方（apple）
     * @param identityToken 提供方签发的 ID token
     * @param expectedNonce 客户端本次使用的 raw nonce；null/空表示不校验
     * @param fallbackName  客户端补充的展示名。Apple 只在<b>首次授权</b>时返回姓名且不放进 JWT，
     *                      故新建账号时需要它；画像自带 name 时以画像为准
     * @param region        当前区域（校验 provider 是否启用 + 新建租户写 region）
     */
    public AuthResult loginWithNativeIdentityToken(String providerType, String identityToken,
                                                   String expectedNonce, String fallbackName,
                                                   Region region) {
        assertProviderEnabledInRegion(providerType, region);

        AuthProvider provider = resolveProvider(providerType);
        if (!provider.supportsNativeIdentityToken()) {
            throw new IllegalArgumentException(
                providerType + " provider does not support native identity token login");
        }

        OAuthUserProfile profile;
        try {
            profile = provider.verifyNativeIdentityToken(identityToken, expectedNonce);
        } catch (OAuthExchangeException e) {
            log.warn("Native identity token verification failed: provider={} reason={} msg={}",
                providerType, e.getReasonCode(), e.getMessage());
            return AuthResult.failure(e.getReasonCode());
        }

        if ((profile.name() == null || profile.name().isBlank())
            && fallbackName != null && !fallbackName.isBlank()) {
            profile = new OAuthUserProfile(
                profile.providerType(), profile.externalId(), profile.email(),
                profile.emailVerified(), fallbackName.trim(), profile.picture());
        }

        return resolveOrCreateAccount(profile, region);
    }

    /**
     * 画像 → 账号：先按 {@code provider:externalId} 找已绑定的 identity，其次按已验证邮箱合并，
     * 都没有则按 region 的默认 AccountModel 建新账号。
     *
     * <p>授权码流和原生 token 流共用，两条路径的账号语义必须完全一致。
     */
    private AuthResult resolveOrCreateAccount(OAuthUserProfile profile, Region region) {
        String oauthIdentifier = profile.toIdentityIdentifier();
        Map<String, Object> existing = identityMapper.findByOAuthIdentifier(oauthIdentifier);

        if (existing != null) {
            return buildResultFromExisting(existing, profile);
        }

        // 策略 A：OAuth identity 没命中时，按 verified email 自动合并到已有账号
        // （前提：OAuth 提供方返回 email_verified=true，且本地有同邮箱的已验证 identity）
        if (profile.emailVerified() && profile.email() != null && !profile.email().isBlank()) {
            Map<String, Object> sameEmailUser = identityMapper.findVerifiedEmailIdentity(profile.email());
            if (sameEmailUser != null) {
                Boolean userEnabled = (Boolean) sameEmailUser.get("userEnabled");
                if (userEnabled != null && !userEnabled) {
                    return AuthResult.failure("account_disabled");
                }
                String tenantStatus = (String) sameEmailUser.get("tenantStatus");
                if ("closing".equals(tenantStatus)) {
                    return AuthResult.failure("account_closing");
                }
                UUID tenantUserId = UUID.fromString(sameEmailUser.get("tenantUserId").toString());
                UUID tenantId = UUID.fromString(sameEmailUser.get("tenantId").toString());
                identityMapper.insertOAuthIdentity(
                    UUID.randomUUID(), tenantUserId, tenantId, oauthIdentifier);
                log.info("OAuth identity {} linked to existing user {} by verified email match",
                    oauthIdentifier, tenantUserId);
                return buildResultFromExisting(sameEmailUser, profile);
            }
        }

        // 建账号必须有邮箱（AccountModel 要写 email identity + 拿它当 loginId）。
        // Apple 只在"首次授权"时下发 email claim；若用户已在 Apple 侧授权过本 app 但本地
        // identity 缺失（如手工删库、换环境），token 里就没有 email —— 明确报错而不是插空邮箱。
        // 用户可在 iOS「設定 → Apple ID → パスワードとセキュリティ → Apple でサインイン」
        // 里撤销本 app 后重新登录，Apple 会再次下发 email。
        if (profile.email() == null || profile.email().isBlank()) {
            log.warn("Cannot create account for {}: provider returned no email", oauthIdentifier);
            return AuthResult.failure("email_missing");
        }

        // 没有：用 region profile 指定的 AccountModel 建新账号
        String modelType = resolveDefaultAccountModel(region);
        AccountModel accountModel = resolveAccountModel(modelType);
        CreatedAccount created = accountModel.createOAuthAccount(profile, region);
        return AuthResult.success(
            created.tenantId(),
            created.tenantUserId(),
            created.loginId(),
            profile.name() != null && !profile.name().isBlank() ? profile.name() : profile.email(),
            profile.email(),
            profile.picture());
    }

    private AuthResult buildResultFromExisting(Map<String, Object> existing, OAuthUserProfile profile) {
        Boolean userEnabled = (Boolean) existing.get("userEnabled");
        if (userEnabled != null && !userEnabled) {
            return AuthResult.failure("account_disabled");
        }
        String tenantStatus = (String) existing.get("tenantStatus");
        if ("closing".equals(tenantStatus)) {
            return AuthResult.failure("account_closing");
        }
        UUID tenantUserId = UUID.fromString(existing.get("tenantUserId").toString());
        UUID tenantId = UUID.fromString(existing.get("tenantId").toString());
        String email = (String) existing.get("email");
        String loginId = email != null ? email : profile.email();
        String displayName = (String) existing.get("displayName");

        // 优先恢复「上次切换的团队」偏好；失效则保持默认团队。
        String prefEmail = email != null ? email : profile.email();
        if (prefEmail != null && !prefEmail.isBlank()) {
            Map<String, Object> preferred = identityMapper.findPreferredTenantUserForLogin(prefEmail);
            if (preferred != null) {
                tenantUserId = UUID.fromString(preferred.get("tenantUserId").toString());
                tenantId = UUID.fromString(preferred.get("tenantId").toString());
                Object dn = preferred.get("displayName");
                if (dn != null) {
                    displayName = (String) dn;
                }
            }
        }

        return AuthResult.success(
            tenantId, tenantUserId, loginId,
            displayName != null ? displayName : profile.name(),
            profile.email(), profile.picture());
    }

    // --- 内部辅助 ---

    protected AuthProvider resolveProvider(String providerType) {
        return authProviders.stream()
            .filter(p -> p.supports(providerType))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("不支持的认证提供者: " + providerType));
    }

    protected AccountModel resolveAccountModel(String modelType) {
        return accountModels.stream()
            .filter(m -> m.supports(modelType))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("不支持的账号模型: " + modelType));
    }

    /**
     * 校验 provider 是否在当前 region 的 profile 中启用。
     * 未配置 region profile（yaml 缺失）则放行，避免误拦截。
     */
    private void assertProviderEnabledInRegion(String providerType, Region region) {
        if (region == null) return;
        RegionProfile profile = regionProfileService.getProfile(region);
        if (profile == null || profile.getEnabledAuthProviders() == null) {
            return;
        }
        if (!profile.getEnabledAuthProviders().contains(providerType)) {
            throw new IllegalArgumentException(
                "Provider '" + providerType + "' is not enabled in region " + region);
        }
    }

    /**
     * region profile 里声明的 default account model；没有则回退到 "single_user"。
     */
    private String resolveDefaultAccountModel(Region region) {
        if (region == null) return "single_user";
        RegionProfile profile = regionProfileService.getProfile(region);
        if (profile == null || profile.getDefaultAccountModel() == null
            || profile.getDefaultAccountModel().isBlank()) {
            return "single_user";
        }
        return profile.getDefaultAccountModel();
    }
}

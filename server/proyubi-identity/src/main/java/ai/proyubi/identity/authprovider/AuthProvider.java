package ai.proyubi.identity.authprovider;

/**
 * 认证提供者接口
 * 不同地区可以有不同的认证方式（Email、Google、Wechat等）
 *
 * <p>分三种调用风格：
 * <ul>
 *   <li><b>密码流</b>：{@link #authenticate(String, String)} — 给 identifier + credential 直接换 AuthResult</li>
 *   <li><b>OAuth 授权码流</b>：{@link #buildAuthUrl(String)} 让前端跳转到授权页，回调拿 code 后
 *       {@link #exchangeOAuth(String)} 换用户画像，再由 IdentityService 决定查/建用户。</li>
 *   <li><b>原生 token 流</b>：{@link #verifyNativeIdentityToken(String, String)} — 客户端在系统层
 *       （如 iOS 的 Sign in with Apple）已经拿到提供方签发的 ID token，后端只验签换画像，
 *       没有后端跳转这一步。</li>
 * </ul>
 *
 * <p>子类按需实现其中一套；其余默认抛 {@link UnsupportedOperationException}。
 *
 */
public interface AuthProvider {

    /**
     * 获取提供者类型
     *
     * @return 提供者类型（email、google、wechat等）
     */
    String getType();

    /**
     * 是否支持该提供者
     *
     * @param type 提供者类型
     * @return 是否支持
     */
    default boolean supports(String type) {
        return getType().equals(type);
    }

    /**
     * 是否是 OAuth 风格的 provider（有外部跳转 + code 换 token）
     */
    default boolean isOAuth() {
        return false;
    }

    /**
     * 是否已配置完毕（如 OAuth 需要 client_id/secret 才能工作）
     */
    default boolean isConfigured() {
        return true;
    }

    // --- 密码流 ---

    /**
     * 验证凭证（密码风格）
     *
     * @param identifier 标识符（用户名、邮箱、手机号等）
     * @param credential 凭证（密码）
     * @return 认证结果
     */
    default AuthResult authenticate(String identifier, String credential) {
        throw new UnsupportedOperationException(
            getType() + " provider does not support password-style authentication");
    }

    // --- OAuth 流 ---

    /**
     * 构造授权页 URL。前端接下来把用户重定向过去。
     *
     * @param state 由 IdentityService 生成的随机 state（用于 CSRF 防护）
     * @return 授权页 URL
     */
    default String buildAuthUrl(String state) {
        throw new UnsupportedOperationException(
            getType() + " provider does not support OAuth authorization URL");
    }

    /**
     * 构造授权页 URL，并显式指定本次使用的 redirect_uri。
     *
     * <p>多前端域名共用一个后端时，redirect_uri 必须跟随发起登录的域名（否则 Google 会把
     * 浏览器送回错误的域）。{@code redirectUri} 为 {@code null}/空时回退到 provider 配置的默认值。
     * 该值必须与随后 {@link #exchangeOAuth(String, String)} 换 token 时使用的 redirect_uri 完全一致。
     *
     * @param state       CSRF state
     * @param redirectUri 本次授权使用的回调地址；null/空表示用配置默认值
     */
    default String buildAuthUrl(String state, String redirectUri) {
        return buildAuthUrl(state);
    }

    /**
     * 用授权 code 换用户画像。
     *
     * @param code 授权码
     * @return 归一化的用户画像
     * @throws OAuthExchangeException 交换失败时抛出
     */
    default OAuthUserProfile exchangeOAuth(String code) {
        throw new UnsupportedOperationException(
            getType() + " provider does not support OAuth code exchange");
    }

    /**
     * 用授权 code 换用户画像，并显式指定换 token 时的 redirect_uri。
     *
     * <p>必须与 {@link #buildAuthUrl(String, String)} 发起授权时使用的 redirect_uri 完全一致，
     * 否则 Google token 交换会返回 {@code redirect_uri_mismatch}。null/空时回退到配置默认值。
     */
    default OAuthUserProfile exchangeOAuth(String code, String redirectUri) {
        return exchangeOAuth(code);
    }

    // --- 原生 token 流 ---

    /**
     * 是否支持"客户端已拿到 ID token，后端只验签"的原生流（Sign in with Apple 走这条）。
     */
    default boolean supportsNativeIdentityToken() {
        return false;
    }

    /**
     * 验证客户端传上来的提供方 ID token，换归一化用户画像。
     *
     * <p>与授权码流的区别：没有后端跳转、没有 code 交换，安全性完全依赖对 JWT 的验签
     * （签名、iss、aud、exp、nonce）。实现方必须做全套校验，否则任何人都能伪造登录。
     *
     * @param identityToken 提供方签发的 JWT（Apple 的 {@code identityToken}）
     * @param expectedNonce 客户端本次登录使用的 raw nonce；null/空表示不校验
     * @return 归一化的用户画像
     * @throws OAuthExchangeException 验签或 claim 校验失败时抛出
     */
    default OAuthUserProfile verifyNativeIdentityToken(String identityToken, String expectedNonce) {
        throw new UnsupportedOperationException(
            getType() + " provider does not support native identity token verification");
    }
}

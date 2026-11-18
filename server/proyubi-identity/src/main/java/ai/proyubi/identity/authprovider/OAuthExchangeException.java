package ai.proyubi.identity.authprovider;

/**
 * OAuth 授权码换 token / userinfo 过程中的错误。
 *
 * <p>用 reasonCode 表示失败原因，供 IdentityService / controller 决定怎么回应用户：
 * <ul>
 *   <li>{@code not_configured} — provider 未配置（缺 client_id/secret）</li>
 *   <li>{@code token_exchange_failed} — Google 返回错误或网络问题</li>
 *   <li>{@code userinfo_failed} — 拿 access_token 但 userinfo 调用失败</li>
 *   <li>{@code userinfo_incomplete} — userinfo 缺 sub/email 等必填字段</li>
 * </ul>
 */
public class OAuthExchangeException extends RuntimeException {

    private final String reasonCode;

    public OAuthExchangeException(String reasonCode, String message) {
        super(message);
        this.reasonCode = reasonCode;
    }

    public OAuthExchangeException(String reasonCode, String message, Throwable cause) {
        super(message, cause);
        this.reasonCode = reasonCode;
    }

    public String getReasonCode() {
        return reasonCode;
    }
}

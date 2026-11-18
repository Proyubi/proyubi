package ai.proyubi.identity.authprovider;

import java.util.UUID;

/**
 * 认证结果
 *
 * <p>统一表示"密码登录"和"OAuth 登录"返回。成功时 success=true，
 * tenantId/tenantUserId/loginId 必填；失败时 success=false，errorCode 说明原因。
 *
 * @param success     是否成功
 * @param tenantId    租户 ID（成功时）
 * @param tenantUserId 用户 ID（成功时）
 * @param loginId     Sa-Token 使用的 loginId 字符串（密码流=username / OAuth 流=email）
 * @param displayName 展示名
 * @param email       邮箱（如果有）
 * @param avatarUrl   头像 URL（如果有）
 * @param errorCode   失败时的错误码（account_disabled / account_closing / not_found 等）
 */
public record AuthResult(
    boolean success,
    UUID tenantId,
    UUID tenantUserId,
    String loginId,
    String displayName,
    String email,
    String avatarUrl,
    String errorCode
) {

    public static AuthResult success(UUID tenantId, UUID tenantUserId, String loginId,
                                     String displayName, String email, String avatarUrl) {
        return new AuthResult(true, tenantId, tenantUserId, loginId, displayName, email, avatarUrl, null);
    }

    public static AuthResult failure(String errorCode) {
        return new AuthResult(false, null, null, null, null, null, null, errorCode);
    }
}

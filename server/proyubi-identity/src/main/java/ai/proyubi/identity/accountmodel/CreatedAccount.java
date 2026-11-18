package ai.proyubi.identity.accountmodel;

import java.util.UUID;

/**
 * AccountModel 创建账号后的结果。
 *
 * @param tenantId     新租户 ID
 * @param tenantUserId 新用户 ID
 * @param loginId      建议用作 Sa-Token loginId 的字符串（OAuth 流 = email）
 */
public record CreatedAccount(UUID tenantId, UUID tenantUserId, String loginId) {
}

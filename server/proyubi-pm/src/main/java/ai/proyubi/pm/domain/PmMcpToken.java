package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * PM MCP 个人连接令牌。
 *
 * 每个租户用户一条有效令牌（deleted_at is null）；用户在「設定 → MCP設定」页拿到
 * {@code https://<base>/t/<token>/mcp}，pm-mcp 服务端凭 token 反查 tenant 后代理调用 /internal/pm/**。
 *
 */
@Data
@Table("pm_mcp_token")
public class PmMcpToken {

    @Id
    private UUID id;

    @Column(tenantId = false)
    private UUID tenantId;

    /** 租户用户 id（platform_tenant_user.id）= TenantContext.getUserId() */
    private UUID userId;

    /** URL 内嵌的随机令牌（SecureRandom 24字节 hex） */
    private String token;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private LocalDateTime lastUsedAt;
    private LocalDateTime deletedAt;
}

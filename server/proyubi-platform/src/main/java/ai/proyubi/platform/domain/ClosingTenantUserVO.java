package ai.proyubi.platform.domain;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 已注销租户用户列表 VO
 *
 */
@Data
public class ClosingTenantUserVO {

    private UUID id;

    /**
     * 租户ID
     */
    private UUID tenantId;

    /**
     * 租户名称
     */
    private String tenantName;

    /**
     * 租户代码
     */
    private String tenantCode;

    /**
     * 显示名称
     */
    private String displayName;

    /**
     * 当前套餐类型（FREE/TRIAL/PRO）
     */
    private String planType;

    /**
     * 注销请求时间
     */
    private LocalDateTime deletionRequestedAt;

    /**
     * 已注销天数
     */
    private Integer deletionDays;

    /**
     * 注册时间
     */
    private LocalDateTime createdAt;
}

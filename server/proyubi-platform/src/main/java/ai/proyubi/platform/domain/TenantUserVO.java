package ai.proyubi.platform.domain;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 租户用户列表 VO
 *
 */
@Data
public class TenantUserVO {

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
     * 头像URL
     */
    private String avatarUrl;

    /**
     * 是否启用
     */
    private Boolean isEnabled;

    /**
     * 最后登录时间
     */
    private LocalDateTime lastLoginAt;

    /**
     * 注册时间
     */
    private LocalDateTime createdAt;

    /**
     * 当前套餐类型（FREE/TRIAL/PRO）
     */
    private String planType;

    /**
     * 订阅状态（active/suspended/cancelled）
     */
    private String subscriptionStatus;
}


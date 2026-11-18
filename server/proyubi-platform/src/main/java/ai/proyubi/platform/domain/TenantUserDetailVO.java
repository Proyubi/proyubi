package ai.proyubi.platform.domain;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 租户用户详情 VO
 *
 */
@Data
public class TenantUserDetailVO {

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
     * 租户区域
     */
    private String tenantRegion;

    /**
     * 租户状态
     */
    private String tenantStatus;

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
     * 更新时间
     */
    private LocalDateTime updatedAt;

    /**
     * 登录标识列表（邮箱/手机号/用户名等）
     */
    private List<IdentityInfo> identities;

    /**
     * 当前套餐类型（FREE/TRIAL/PRO）
     */
    private String planType;

    /**
     * 订阅状态（active/suspended/cancelled）
     */
    private String subscriptionStatus;

    /**
     * 当前账期开始时间
     */
    private LocalDateTime currentPeriodStart;

    /**
     * 当前账期结束时间
     */
    private LocalDateTime currentPeriodEnd;

    /**
     * 宽限期结束时间
     */
    private LocalDateTime gracePeriodEnd;

    /**
     * 登录标识信息
     */
    @Data
    public static class IdentityInfo {
        private UUID id;
        private String identityType; // username/email/phone/oauth
        private String identifier;
        private Boolean isVerified;
        private Boolean isEnabled;
        private LocalDateTime createdAt;
    }
}


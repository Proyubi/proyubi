package ai.proyubi.platform.domain;

import lombok.Data;

/**
 * 租户详情 VO
 */
@Data
public class TenantDetailVO {
    private String id;
    private String code;
    private String name;
    private String region;
    private String status;
    private String stripeCustomerId;
    private String deletionRequestedAt;
    private String createdAt;
    private String updatedAt;

    // 订阅信息
    private String planType;
    private String subscriptionStatus;
    private String currentPeriodStart;
    private String currentPeriodEnd;
    private String gracePeriodEnd;

    // Owner 信息
    private String ownerId;
    private String ownerDisplayName;
    private String ownerLastLoginAt;

    // 统计
    private Integer memberCount;

    // 登录页品牌与自定义域名（仅展示用）
    private String customDomain;
    private String loginLogoUrl;
    private String loginTitle;
    private String loginSubtitle;
}

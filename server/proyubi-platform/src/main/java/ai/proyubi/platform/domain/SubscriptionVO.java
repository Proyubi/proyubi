package ai.proyubi.platform.domain;

import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 订阅信息 VO
 *
 */
@Data
public class SubscriptionVO {

    private UUID id;

    /**
     * 租户ID
     */
    private UUID tenantId;

    /**
     * 所属模块（platform_module.code：wms/pm/bk）。per-module 订阅。
     */
    private String module;

    /**
     * 租户名称
     */
    private String tenantName;

    /**
     * 租户代码
     */
    private String tenantCode;

    /**
     * 套餐类型（FREE/TRIAL/PRO）
     */
    private String planType;

    /**
     * 订阅状态（active/suspended/cancelled）
     */
    private String status;

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
     * 是否在宽限期内
     */
    private Boolean isInGracePeriod;

    /**
     * Stripe Subscription ID
     */
    private String stripeSubscriptionId;

    /**
     * 是否已自助使用过试用（一次性）
     */
    private Boolean trialUsed;

    /**
     * 是否可以开启 14 天试用（FREE 且未用过 trial）
     * 服务端计算后下发，前端用来决定是否弹出试用 Modal
     */
    private Boolean eligibleForTrial;

    /**
     * 创建时间
     */
    private LocalDateTime createdAt;

    /**
     * 更新时间
     */
    private LocalDateTime updatedAt;
}


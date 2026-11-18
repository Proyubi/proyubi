package ai.proyubi.platform.mapper;

import ai.proyubi.platform.domain.SubscriptionVO;
import org.apache.ibatis.annotations.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 订阅 Mapper
 *
 */
@Mapper
public interface SubscriptionMapper {

    /**
     * 分页查询订阅列表
     */
    @Select("""
        <script>
        SELECT 
            s.id,
            s.tenant_id,
            s.module,
            t.name AS tenant_name,
            t.code AS tenant_code,
            s.plan_type,
            s.status,
            s.current_period_start,
            s.current_period_end,
            s.grace_period_end,
            CASE
                WHEN s.grace_period_end IS NOT NULL AND s.grace_period_end > now()
                THEN true
                ELSE false
            END AS is_in_grace_period,
            s.stripe_subscription_id,
            s.trial_used,
            s.created_at,
            s.updated_at
        FROM platform_subscription s
        LEFT JOIN platform_tenant t ON s.tenant_id = t.id AND t.deleted_at IS NULL
        WHERE 1=1
        <if test="keyword != null and keyword != ''">
          AND (t.name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.code ILIKE CONCAT('%', #{keyword}, '%'))
        </if>
        <if test="planType != null and planType != ''">
          AND s.plan_type = #{planType}
        </if>
        <if test="status != null and status != ''">
          AND s.status = #{status}
        </if>
        <if test="module != null and module != ''">
          AND s.module = #{module}
        </if>
        ORDER BY s.created_at DESC
        LIMIT #{limit} OFFSET #{offset}
        </script>
        """)
    List<SubscriptionVO> selectSubscriptionList(
        @Param("keyword") String keyword,
        @Param("planType") String planType,
        @Param("status") String status,
        @Param("module") String module,
        @Param("limit") int limit,
        @Param("offset") int offset
    );

    /**
     * 查询订阅总数
     */
    @Select("""
        <script>
        SELECT COUNT(*)
        FROM platform_subscription s
        LEFT JOIN platform_tenant t ON s.tenant_id = t.id AND t.deleted_at IS NULL
        WHERE 1=1
        <if test="keyword != null and keyword != ''">
          AND (t.name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.code ILIKE CONCAT('%', #{keyword}, '%'))
        </if>
        <if test="planType != null and planType != ''">
          AND s.plan_type = #{planType}
        </if>
        <if test="status != null and status != ''">
          AND s.status = #{status}
        </if>
        <if test="module != null and module != ''">
          AND s.module = #{module}
        </if>
        </script>
        """)
    long countSubscriptions(
        @Param("keyword") String keyword,
        @Param("planType") String planType,
        @Param("status") String status,
        @Param("module") String module
    );

    /**
     * 查询订阅详情（根据订阅ID）
     */
    @Select("""
        SELECT 
            s.id,
            s.tenant_id,
            s.module,
            t.name AS tenant_name,
            t.code AS tenant_code,
            s.plan_type,
            s.status,
            s.current_period_start,
            s.current_period_end,
            s.grace_period_end,
            CASE
                WHEN s.grace_period_end IS NOT NULL AND s.grace_period_end > now()
                THEN true
                ELSE false
            END AS is_in_grace_period,
            s.stripe_subscription_id,
            s.trial_used,
            s.created_at,
            s.updated_at
        FROM platform_subscription s
        LEFT JOIN platform_tenant t ON s.tenant_id = t.id AND t.deleted_at IS NULL
        WHERE s.id = #{id}
        """)
    SubscriptionVO selectSubscriptionDetail(@Param("id") UUID id);

    /**
     * 根据租户ID查询活跃订阅
     */
    @Select("""
        SELECT 
            s.id,
            s.tenant_id,
            s.module,
            t.name AS tenant_name,
            t.code AS tenant_code,
            s.plan_type,
            s.status,
            s.current_period_start,
            s.current_period_end,
            s.grace_period_end,
            CASE
                WHEN s.grace_period_end IS NOT NULL AND s.grace_period_end > now()
                THEN true
                ELSE false
            END AS is_in_grace_period,
            s.stripe_subscription_id,
            s.trial_used,
            s.created_at,
            s.updated_at
        FROM platform_subscription s
        LEFT JOIN platform_tenant t ON s.tenant_id = t.id AND t.deleted_at IS NULL
        WHERE s.tenant_id = #{tenantId}
          AND s.module = #{module}
          AND s.status = 'active'
        ORDER BY s.created_at DESC
        LIMIT 1
        """)
    SubscriptionVO selectActiveSubscriptionByTenantId(@Param("tenantId") UUID tenantId,
                                                      @Param("module") String module);

    /**
     * 延长试用期
     */
    @Update("""
        UPDATE platform_subscription
        SET current_period_end = current_period_end + (INTERVAL '1 day' * #{days}),
            grace_period_end = COALESCE(grace_period_end, current_period_end) + (INTERVAL '1 day' * #{days}),
            updated_at = now()
        WHERE id = #{id} AND plan_type = 'TRIAL'
        """)
    int extendTrial(@Param("id") UUID id, @Param("days") int days);

    /**
     * 恢复订阅
     */
    @Update("""
        UPDATE platform_subscription
        SET status = 'active',
            updated_at = now()
        WHERE id = #{id} AND status IN ('suspended', 'cancelled')
        """)
    int restoreSubscription(@Param("id") UUID id);

    /**
     * 升级订阅（更新套餐类型和计划ID）
     */
    @Update("""
        UPDATE platform_subscription
        SET plan_type = #{planType},
            plan_id = #{planId},
            current_period_start = now(),
            current_period_end = now() + INTERVAL '1 month',
            updated_at = now()
        WHERE tenant_id = #{tenantId} AND module = #{module} AND status = 'active'
        """)
    int upgradeSubscription(@Param("tenantId") UUID tenantId, @Param("module") String module,
                            @Param("planType") String planType, @Param("planId") UUID planId);

    /**
     * 查询租户某模块最近一条订阅（不限状态）
     */
    @Select("""
        SELECT id FROM platform_subscription
        WHERE tenant_id = #{tenantId} AND module = #{module}
        ORDER BY created_at DESC
        LIMIT 1
        """)
    UUID selectLatestSubscriptionIdByTenantId(@Param("tenantId") UUID tenantId,
                                              @Param("module") String module);

    /**
     * 运营手动切换套餐：立即生效
     * - 强制 status=active、清空 grace_period_end
     * - current_period_start=now()，current_period_end 由调用方计算（FREE 传 null）
     */
    @Update("""
        UPDATE platform_subscription
        SET plan_type = #{planType},
            plan_id = #{planId},
            status = 'active',
            current_period_start = now(),
            current_period_end = #{periodEnd},
            grace_period_end = NULL,
            updated_at = now()
        WHERE id = #{id}
        """)
    int changePlan(
        @Param("id") UUID id,
        @Param("planType") String planType,
        @Param("planId") UUID planId,
        @Param("periodEnd") LocalDateTime periodEnd
    );

    /**
     * 兜底：为缺失订阅记录的租户插入一条
     */
    @Insert("""
        INSERT INTO platform_subscription
            (id, tenant_id, module, plan_type, plan_id, status,
             current_period_start, current_period_end,
             created_at, updated_at)
        VALUES
            (#{id}, #{tenantId}, #{module}, #{planType}, #{planId}, 'active',
             now(), #{periodEnd},
             now(), now())
        """)
    int insertSubscription(
        @Param("id") UUID id,
        @Param("tenantId") UUID tenantId,
        @Param("module") String module,
        @Param("planType") String planType,
        @Param("planId") UUID planId,
        @Param("periodEnd") LocalDateTime periodEnd
    );

    /**
     * 查询即将到期订阅数（N天内到期）
     */
    @Select("""
        SELECT COUNT(*)
        FROM platform_subscription
        WHERE status = 'active'
          AND current_period_end IS NOT NULL
          AND current_period_end >= now()
          AND current_period_end <= now() + (INTERVAL '1 day' * #{days})
        """)
    Long countExpiringSoonSubscriptions(@Param("days") int days);

    /**
     * 根据 Stripe Subscription ID 查询订阅
     */
    @Select("""
        SELECT
            s.id,
            s.tenant_id,
            s.module,
            t.name AS tenant_name,
            t.code AS tenant_code,
            s.plan_type,
            s.status,
            s.current_period_start,
            s.current_period_end,
            s.grace_period_end,
            s.stripe_subscription_id,
            s.trial_used,
            s.created_at,
            s.updated_at
        FROM platform_subscription s
        LEFT JOIN platform_tenant t ON s.tenant_id = t.id AND t.deleted_at IS NULL
        WHERE s.stripe_subscription_id = #{stripeSubscriptionId}
        """)
    SubscriptionVO selectByStripeSubscriptionId(@Param("stripeSubscriptionId") String stripeSubscriptionId);

    /**
     * 更新 Stripe Subscription ID
     */
    /**
     * 更新 Stripe Subscription ID。
     * per-module 拆分后 Stripe 计费本期仅落 wms 模块（stripe_subscription_id 唯一索引不允许跨行复制），
     * 故固定作用于 module='wms' 的活跃订阅；待 per-module Stripe 落地再泛化。
     */
    @Update("""
        UPDATE platform_subscription
        SET stripe_subscription_id = #{stripeSubscriptionId},
            updated_at = now()
        WHERE tenant_id = #{tenantId} AND module = 'wms' AND status = 'active'
        """)
    int updateStripeSubscriptionId(@Param("tenantId") UUID tenantId, @Param("stripeSubscriptionId") String stripeSubscriptionId);

    /**
     * 通过 Stripe Webhook 更新订阅状态和账期
     */
    @Update("""
        UPDATE platform_subscription
        SET plan_type = #{planType},
            status = #{status},
            current_period_start = #{periodStart},
            current_period_end = #{periodEnd},
            updated_at = now()
        WHERE stripe_subscription_id = #{stripeSubscriptionId}
        """)
    int updateFromWebhook(
        @Param("stripeSubscriptionId") String stripeSubscriptionId,
        @Param("planType") String planType,
        @Param("status") String status,
        @Param("periodStart") LocalDateTime periodStart,
        @Param("periodEnd") LocalDateTime periodEnd
    );

    /**
     * 设置宽限期
     */
    @Update("""
        UPDATE platform_subscription
        SET grace_period_end = #{gracePeriodEnd},
            updated_at = now()
        WHERE stripe_subscription_id = #{stripeSubscriptionId}
        """)
    int setGracePeriod(@Param("stripeSubscriptionId") String stripeSubscriptionId, @Param("gracePeriodEnd") LocalDateTime gracePeriodEnd);

    /**
     * 清除宽限期（支付成功后）
     */
    @Update("""
        UPDATE platform_subscription
        SET grace_period_end = NULL,
            status = 'active',
            updated_at = now()
        WHERE stripe_subscription_id = #{stripeSubscriptionId}
        """)
    int clearGracePeriod(@Param("stripeSubscriptionId") String stripeSubscriptionId);

    /**
     * 标记试用已被使用（自助 start-trial 触发，一次性）
     */
    @Update("""
        UPDATE platform_subscription
        SET trial_used = true,
            updated_at = now()
        WHERE id = #{id}
        """)
    int markTrialUsed(@Param("id") UUID id);
}


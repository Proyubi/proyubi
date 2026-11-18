package ai.proyubi.platform.mapper;

import ai.proyubi.platform.domain.TenantDetailVO;
import ai.proyubi.platform.domain.TenantVO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 租户 Mapper
 */
@Mapper
public interface TenantMapper {

    /**
     * 分页查询租户列表（排除已注销）
     */
    @Select("""
        <script>
        SELECT
            t.id,
            t.code,
            t.name,
            t.region,
            t.status,
            COALESCE(s.plan_type, 'FREE') AS plan_type,
            COALESCE(s.status, 'active') AS subscription_status,
            (SELECT COUNT(*) FROM platform_tenant_user tu
             WHERE tu.tenant_id = t.id AND tu.role = 'member' AND tu.deleted_at IS NULL) AS member_count,
            t.created_at,
            t.updated_at
        FROM platform_tenant t
        LEFT JOIN LATERAL (
            SELECT su.plan_type, su.status
            FROM platform_subscription su
            WHERE su.tenant_id = t.id AND su.status = 'active'
            ORDER BY (su.plan_type = 'FREE'), su.created_at DESC
            LIMIT 1
        ) s ON true
        WHERE t.deleted_at IS NULL
          AND t.status != 'closing'
        <if test="keyword != null and keyword != ''">
          AND (t.name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.code ILIKE CONCAT('%', #{keyword}, '%'))
        </if>
        ORDER BY t.created_at DESC
        LIMIT #{limit} OFFSET #{offset}
        </script>
        """)
    List<TenantVO> selectTenantList(
        @Param("keyword") String keyword,
        @Param("limit") int limit,
        @Param("offset") int offset
    );

    /**
     * 查询租户总数（排除已注销）
     */
    @Select("""
        <script>
        SELECT COUNT(*)
        FROM platform_tenant t
        WHERE t.deleted_at IS NULL
          AND t.status != 'closing'
        <if test="keyword != null and keyword != ''">
          AND (t.name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.code ILIKE CONCAT('%', #{keyword}, '%'))
        </if>
        </script>
        """)
    long countTenants(@Param("keyword") String keyword);

    /**
     * 查询租户详情
     */
    @Select("""
        SELECT
            t.id,
            t.code,
            t.name,
            t.region,
            t.status,
            t.stripe_customer_id,
            t.deletion_requested_at,
            t.custom_domain,
            t.login_logo_url,
            t.login_title,
            t.login_subtitle,
            t.created_at,
            t.updated_at,
            COALESCE(s.plan_type, 'FREE') AS plan_type,
            COALESCE(s.status, 'active') AS subscription_status,
            s.current_period_start,
            s.current_period_end,
            s.grace_period_end,
            owner.id AS owner_id,
            owner.display_name AS owner_display_name,
            owner.last_login_at AS owner_last_login_at,
            (SELECT COUNT(*) FROM platform_tenant_user tu
             WHERE tu.tenant_id = t.id AND tu.role = 'member' AND tu.deleted_at IS NULL) AS member_count
        FROM platform_tenant t
        LEFT JOIN LATERAL (
            SELECT su.plan_type, su.status, su.current_period_start, su.current_period_end, su.grace_period_end
            FROM platform_subscription su
            WHERE su.tenant_id = t.id AND su.status = 'active'
            ORDER BY su.current_period_end DESC NULLS LAST
            LIMIT 1
        ) s ON TRUE
        LEFT JOIN LATERAL (
            SELECT tu.id, tu.display_name, tu.last_login_at
            FROM platform_tenant_user tu
            WHERE tu.tenant_id = t.id AND tu.role = 'owner' AND tu.deleted_at IS NULL
            ORDER BY tu.created_at ASC
            LIMIT 1
        ) owner ON TRUE
        WHERE t.id = #{id} AND t.deleted_at IS NULL
        """)
    TenantDetailVO selectTenantDetail(@Param("id") UUID id);

    /**
     * 按域名查询登录页展示用的基础信息（公开接口用）
     */
    @Select("""
        SELECT t.name,
               t.login_logo_url,
               t.login_title,
               t.login_subtitle
        FROM platform_tenant t
        WHERE t.deleted_at IS NULL
          AND t.status = 'active'
          AND t.custom_domain IS NOT NULL
          AND lower(t.custom_domain) = lower(#{host})
        LIMIT 1
        """)
    Map<String, Object> selectPublicBrandingByDomain(@Param("host") String host);

    /**
     * 检查自定义域名是否已被其他租户占用
     */
    @Select("""
        SELECT COUNT(1)
        FROM platform_tenant
        WHERE deleted_at IS NULL
          AND custom_domain IS NOT NULL
          AND lower(custom_domain) = lower(#{domain})
          AND id <> #{excludeId}
        """)
    long countByCustomDomainExcluding(@Param("domain") String domain, @Param("excludeId") UUID excludeId);

    /**
     * 更新租户登录页品牌与自定义域名
     */
    @Update("""
        UPDATE platform_tenant
        SET custom_domain   = #{customDomain},
            login_logo_url  = #{loginLogoUrl},
            login_title     = #{loginTitle},
            login_subtitle  = #{loginSubtitle},
            updated_at      = now()
        WHERE id = #{id} AND deleted_at IS NULL
        """)
    int updateBranding(@Param("id") UUID id,
                       @Param("customDomain") String customDomain,
                       @Param("loginLogoUrl") String loginLogoUrl,
                       @Param("loginTitle") String loginTitle,
                       @Param("loginSubtitle") String loginSubtitle);

    /**
     * 查询租户 logo URL（用于删除旧文件）
     */
    @Select("SELECT login_logo_url FROM platform_tenant WHERE id = #{id} AND deleted_at IS NULL")
    String selectLoginLogoUrl(@Param("id") UUID id);

    /**
     * 仅更新 logo 字段
     */
    @Update("""
        UPDATE platform_tenant
        SET login_logo_url = #{url},
            updated_at     = now()
        WHERE id = #{id} AND deleted_at IS NULL
        """)
    int updateLoginLogoUrl(@Param("id") UUID id, @Param("url") String url);
}

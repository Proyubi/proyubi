package ai.proyubi.platform.mapper;

import ai.proyubi.platform.domain.ClosingTenantUserVO;
import ai.proyubi.platform.domain.TenantUserDetailVO;
import ai.proyubi.platform.domain.TenantUserVO;
import org.apache.ibatis.annotations.*;

import java.util.Map;

import java.util.List;
import java.util.UUID;

/**
 * 租户用户 Mapper
 *
 */
@Mapper
public interface TenantUserMapper {

    /**
     * 分页查询租户主账号列表（仅 owner），排除已注销用户
     */
    @Select("""
        <script>
        SELECT
            tu.id,
            tu.tenant_id,
            t.name AS tenant_name,
            t.code AS tenant_code,
            tu.display_name,
            tu.avatar_url,
            tu.is_enabled,
            tu.last_login_at,
            tu.created_at,
            COALESCE(s.plan_type, 'FREE') AS plan_type,
            COALESCE(s.status, 'active') AS subscription_status
        FROM platform_tenant_user tu
        LEFT JOIN platform_tenant t ON tu.tenant_id = t.id AND t.deleted_at IS NULL
        LEFT JOIN LATERAL (
            SELECT sub.plan_type, sub.status
            FROM platform_subscription sub
            WHERE sub.tenant_id = tu.tenant_id AND sub.status = 'active'
            ORDER BY (sub.plan_type = 'FREE'), sub.created_at DESC
            LIMIT 1
        ) s ON true
        WHERE tu.deleted_at IS NULL
          AND tu.role = 'owner'
          AND (t.status IS NULL OR t.status != 'closing')
        <if test="keyword != null and keyword != ''">
          AND (tu.display_name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.code ILIKE CONCAT('%', #{keyword}, '%'))
        </if>
        ORDER BY tu.created_at DESC
        LIMIT #{limit} OFFSET #{offset}
        </script>
        """)
    List<TenantUserVO> selectUserList(
        @Param("keyword") String keyword,
        @Param("limit") int limit,
        @Param("offset") int offset
    );

    /**
     * 查询主账号总数（仅 owner，用于分页），排除已注销用户
     */
    @Select("""
        <script>
        SELECT COUNT(*)
        FROM platform_tenant_user tu
        LEFT JOIN platform_tenant t ON tu.tenant_id = t.id AND t.deleted_at IS NULL
        WHERE tu.deleted_at IS NULL
          AND tu.role = 'owner'
          AND (t.status IS NULL OR t.status != 'closing')
        <if test="keyword != null and keyword != ''">
          AND (tu.display_name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.code ILIKE CONCAT('%', #{keyword}, '%'))
        </if>
        </script>
        """)
    long countUsers(@Param("keyword") String keyword);

    /**
     * 查询某租户下的子账号列表（role = 'member'）
     */
    @Select("""
        SELECT
            tu.id,
            tu.display_name,
            tu.is_enabled,
            tu.last_login_at,
            tu.created_at
        FROM platform_tenant_user tu
        WHERE tu.tenant_id = #{tenantId}
          AND tu.role = 'member'
          AND tu.deleted_at IS NULL
        ORDER BY tu.created_at DESC
        """)
    List<Map<String, Object>> selectMembersByTenantId(@Param("tenantId") UUID tenantId);

    /**
     * 查询用户详情（关联 tenant 和 subscription）
     */
    @Select("""
        SELECT
            tu.id,
            tu.tenant_id,
            t.name AS tenant_name,
            t.code AS tenant_code,
            t.region AS tenant_region,
            t.status AS tenant_status,
            tu.display_name,
            tu.avatar_url,
            tu.is_enabled,
            tu.last_login_at,
            tu.created_at,
            tu.updated_at,
            COALESCE(s.plan_type, 'FREE') AS plan_type,
            COALESCE(s.status, 'active') AS subscription_status,
            s.current_period_start,
            s.current_period_end,
            s.grace_period_end
        FROM platform_tenant_user tu
        LEFT JOIN platform_tenant t ON tu.tenant_id = t.id AND t.deleted_at IS NULL
        LEFT JOIN LATERAL (
            SELECT sub.plan_type, sub.status,
                   sub.current_period_start, sub.current_period_end, sub.grace_period_end
            FROM platform_subscription sub
            WHERE sub.tenant_id = tu.tenant_id AND sub.status = 'active'
            ORDER BY (sub.plan_type = 'FREE'), sub.created_at DESC
            LIMIT 1
        ) s ON true
        WHERE tu.id = #{id} AND tu.deleted_at IS NULL
        """)
    TenantUserDetailVO selectUserDetail(@Param("id") UUID id);

    /**
     * 更新用户启用状态
     */
    @Update("""
        UPDATE platform_tenant_user
        SET is_enabled = #{enabled},
            updated_at = now()
        WHERE id = #{id} AND deleted_at IS NULL
        """)
    int updateUserEnabled(@Param("id") UUID id, @Param("enabled") boolean enabled);

    /**
     * 查询用户登录标识列表
     */
    @Select("""
        SELECT
            id,
            identity_type,
            identifier,
            is_verified,
            is_enabled,
            created_at
        FROM platform_tenant_user_identity
        WHERE tenant_user_id = #{userId} AND deleted_at IS NULL
        ORDER BY created_at DESC
        """)
    List<TenantUserDetailVO.IdentityInfo> selectUserIdentities(@Param("userId") UUID userId);

    // --- 已注销用户相关 ---

    /**
     * 分页查询已注销（closing）租户用户列表
     */
    @Select("""
        <script>
        SELECT
            tu.id,
            tu.tenant_id,
            t.name AS tenant_name,
            t.code AS tenant_code,
            tu.display_name,
            COALESCE(s.plan_type, 'FREE') AS plan_type,
            t.deletion_requested_at,
            EXTRACT(DAY FROM (now() - t.deletion_requested_at))::int AS deletion_days,
            tu.created_at
        FROM platform_tenant_user tu
        JOIN platform_tenant t ON tu.tenant_id = t.id AND t.deleted_at IS NULL
        LEFT JOIN LATERAL (
            SELECT sub.plan_type
            FROM platform_subscription sub
            WHERE sub.tenant_id = tu.tenant_id AND sub.status = 'active'
            ORDER BY (sub.plan_type = 'FREE'), sub.created_at DESC
            LIMIT 1
        ) s ON true
        WHERE tu.deleted_at IS NULL
          AND t.status = 'closing'
        <if test="keyword != null and keyword != ''">
          AND (tu.display_name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.code ILIKE CONCAT('%', #{keyword}, '%'))
        </if>
        ORDER BY t.deletion_requested_at DESC
        LIMIT #{limit} OFFSET #{offset}
        </script>
        """)
    List<ClosingTenantUserVO> selectClosingUserList(
        @Param("keyword") String keyword,
        @Param("limit") int limit,
        @Param("offset") int offset
    );

    /**
     * 查询已注销用户总数
     */
    @Select("""
        <script>
        SELECT COUNT(*)
        FROM platform_tenant_user tu
        JOIN platform_tenant t ON tu.tenant_id = t.id AND t.deleted_at IS NULL
        WHERE tu.deleted_at IS NULL
          AND t.status = 'closing'
        <if test="keyword != null and keyword != ''">
          AND (tu.display_name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.name ILIKE CONCAT('%', #{keyword}, '%')
               OR t.code ILIKE CONCAT('%', #{keyword}, '%'))
        </if>
        </script>
        """)
    long countClosingUsers(@Param("keyword") String keyword);

    /**
     * 通过租户用户ID查找租户ID
     */
    @Select("""
        SELECT tu.tenant_id
        FROM platform_tenant_user tu
        WHERE tu.id = #{userId} AND tu.deleted_at IS NULL
        """)
    UUID findTenantIdByUserId(@Param("userId") UUID userId);

    /**
     * 恢复已注销账户
     */
    @Update("""
        UPDATE platform_tenant
        SET status = 'active',
            deletion_requested_at = NULL,
            updated_at = now()
        WHERE id = #{tenantId}
          AND status = 'closing'
          AND deleted_at IS NULL
        """)
    int restoreTenant(@Param("tenantId") UUID tenantId);

    /**
     * 查询用户角色（用于 BootstrapService 权限过滤）
     */
    @Select("""
        SELECT role FROM platform_tenant_user
        WHERE id = #{tenantUserId} AND deleted_at IS NULL
    """)
    String findRoleByTenantUserId(@Param("tenantUserId") UUID tenantUserId);

    /**
     * 查询用户在某模块的 grant 权限 JSON（③-b：模型 A，权限按模块存 platform_module_grant，
     * 用于 BootstrapService 对 member 角色的权限过滤）。
     * 返回 null 表示该模块未设自定义权限 → 使用默认 member 权限集。
     */
    @Select("""
        SELECT permissions::text FROM platform_module_grant
        WHERE tenant_user_id = #{userId} AND module = #{module} AND deleted_at IS NULL
    """)
    String findGrantPermissions(@Param("userId") UUID userId, @Param("module") String module);
}

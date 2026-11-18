package ai.proyubi.account.mapper;

import org.apache.ibatis.annotations.*;

import java.util.*;

/**
 * 团队管理 Mapper
 *
 */
@Mapper
public interface AppTeamMapper {

    /**
     * 查询租户下所有成员列表
     */
    @Select("""
        SELECT tu.id, tu.display_name, tu.role, tu.is_enabled, tu.created_by_owner,
               tu.created_at, tu.last_login_at,
               (g.permissions IS NOT NULL) AS has_custom_permissions,
               i.identifier AS username
        FROM platform_tenant_user tu
        LEFT JOIN platform_tenant_user_identity i
            ON i.tenant_user_id = tu.id AND i.identity_type = 'username' AND i.deleted_at IS NULL
        LEFT JOIN platform_module_grant g
            ON g.tenant_user_id = tu.id AND g.module = 'wms' AND g.deleted_at IS NULL
        WHERE tu.tenant_id = #{tenantId}
          AND tu.deleted_at IS NULL
        ORDER BY tu.created_at ASC
    """)
    List<Map<String, Object>> listMembersByTenantId(@Param("tenantId") UUID tenantId);

    /**
     * 统计租户下成员数量
     */
    @Select("""
        SELECT COUNT(*) FROM platform_tenant_user
        WHERE tenant_id = #{tenantId} AND deleted_at IS NULL
    """)
    int countMembersByTenantId(@Param("tenantId") UUID tenantId);

    /**
     * 查询单个成员信息
     */
    @Select("""
        SELECT tu.id, tu.tenant_id, tu.display_name, tu.role, tu.is_enabled, tu.created_by_owner
        FROM platform_tenant_user tu
        WHERE tu.id = #{id} AND tu.tenant_id = #{tenantId} AND tu.deleted_at IS NULL
    """)
    Map<String, Object> findMemberById(@Param("id") UUID id, @Param("tenantId") UUID tenantId);

    /**
     * 查询用户角色
     */
    @Select("""
        SELECT role FROM platform_tenant_user
        WHERE id = #{tenantUserId} AND deleted_at IS NULL
    """)
    String findRoleByTenantUserId(@Param("tenantUserId") UUID tenantUserId);

    /**
     * 查询租户名称（即团队名）
     */
    @Select("""
        SELECT name FROM platform_tenant
        WHERE id = #{tenantId} AND deleted_at IS NULL
    """)
    String findTenantName(@Param("tenantId") UUID tenantId);

    /**
     * 更新租户名称（即团队名，仅 owner 可改）
     */
    @Update("""
        UPDATE platform_tenant
        SET name = #{name}, updated_at = now()
        WHERE id = #{tenantId} AND deleted_at IS NULL
    """)
    void updateTenantName(@Param("tenantId") UUID tenantId, @Param("name") String name);

    /**
     * 启用/禁用成员
     */
    @Update("""
        UPDATE platform_tenant_user
        SET is_enabled = #{isEnabled}, updated_at = now()
        WHERE id = #{id} AND deleted_at IS NULL
    """)
    void updateMemberEnabled(@Param("id") UUID id, @Param("isEnabled") boolean isEnabled);

    /**
     * 禁用成员的所有登录标识
     */
    @Update("""
        UPDATE platform_tenant_user_identity
        SET is_enabled = #{isEnabled}, updated_at = now()
        WHERE tenant_user_id = #{tenantUserId} AND deleted_at IS NULL
    """)
    void updateIdentitiesEnabled(@Param("tenantUserId") UUID tenantUserId, @Param("isEnabled") boolean isEnabled);

    /**
     * 软删除成员
     */
    @Update("""
        UPDATE platform_tenant_user
        SET deleted_at = now(), updated_at = now()
        WHERE id = #{id} AND deleted_at IS NULL
    """)
    void softDeleteMember(@Param("id") UUID id);

    /**
     * 软删除成员的所有登录标识
     */
    @Update("""
        UPDATE platform_tenant_user_identity
        SET deleted_at = now(), updated_at = now()
        WHERE tenant_user_id = #{tenantUserId} AND deleted_at IS NULL
    """)
    void softDeleteIdentities(@Param("tenantUserId") UUID tenantUserId);

    /**
     * 查询成员在某模块的 grant 权限 JSON（③-b：模型 A，权限按模块存于 platform_module_grant）。
     * 返回 null = 该成员该模块未设自定义权限 → 用模块默认集。
     */
    @Select("""
        SELECT permissions::text FROM platform_module_grant
        WHERE tenant_user_id = #{memberId} AND tenant_id = #{tenantId}
          AND module = #{module} AND deleted_at IS NULL
    """)
    String findGrantPermissions(@Param("memberId") UUID memberId,
                                @Param("tenantId") UUID tenantId,
                                @Param("module") String module);

    /**
     * upsert 成员某模块 grant 的权限（permissions=null 表示恢复默认）。
     * grant 行通常已存在(②回填/邀请创建)，故 ON CONFLICT 只更新 permissions，保留既有 role；
     * 仅在 grant 缺失时按传入 role 兜底插入。
     */
    @Insert("""
        INSERT INTO platform_module_grant (tenant_id, tenant_user_id, module, role, permissions)
        VALUES (#{tenantId}, #{memberId}, #{module}, #{role}, #{permissions}::jsonb)
        ON CONFLICT (tenant_id, tenant_user_id, module) WHERE deleted_at IS NULL
        DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now()
    """)
    void upsertGrantPermissions(@Param("tenantId") UUID tenantId,
                                @Param("memberId") UUID memberId,
                                @Param("module") String module,
                                @Param("role") String role,
                                @Param("permissions") String permissions);

    /**
     * 查询租户套餐可分配的权限列表（按能力分组）
     * 排除 app:team:* 权限（成员不能管理团队）
     */
    @Select("""
        SELECT c.code AS capability_code, c.name AS capability_name,
               pd.code AS permission_code, pd.name AS permission_name, pd.type AS permission_type
        FROM platform_plan p
        JOIN platform_plan_capability pc ON pc.plan_id = p.id
        JOIN platform_capability c ON pc.capability_id = c.id AND c.deleted_at IS NULL
        JOIN platform_capability_permission cp ON cp.capability_id = c.id
        JOIN platform_permission_def pd ON cp.permission_id = pd.id AND pd.deleted_at IS NULL
        WHERE p.module = 'wms' AND p.code = 'wms-' || lower(#{planCode}) AND p.deleted_at IS NULL
          AND pc.status IN ('enabled', 'enabled_with_limit')
          AND pd.code LIKE 'app:%'
          AND pd.code NOT LIKE 'app:team:%'
        ORDER BY c.code, pd.code
    """)
    List<Map<String, Object>> selectAssignablePermissions(@Param("planCode") String planCode);

    /**
     * 查询租户当前套餐档位 token（WMS 模块；FREE/TRIAL/PRO）。
     * per-module 拆分后须按 module='wms' 取，否则租户的多模块活跃订阅会返回多行。
     */
    @Select("""
        SELECT COALESCE(s.plan_type, 'FREE')
        FROM platform_tenant t
        LEFT JOIN platform_subscription s
            ON s.tenant_id = t.id AND s.module = 'wms' AND s.status = 'active'
        WHERE t.id = #{tenantId} AND t.deleted_at IS NULL
    """)
    String findPlanCodeByTenantId(@Param("tenantId") UUID tenantId);

    /**
     * 更新成员信息（昵称、角色）
     */
    @Update("""
        UPDATE platform_tenant_user
        SET display_name = #{displayName}, role = #{role}, updated_at = now()
        WHERE id = #{id} AND tenant_id = #{tenantId} AND deleted_at IS NULL
    """)
    void updateMemberInfo(@Param("id") UUID id, @Param("tenantId") UUID tenantId,
                          @Param("displayName") String displayName, @Param("role") String role);

    /**
     * 管理员改成员表示名时，同步 PM 甘特显示名（pm_member.name）。
     *
     * <p>仅覆盖名仍等于「当前（旧）display_name」的成员，保护自定义甘特名；
     * <b>必须在 {@link #updateMemberInfo} 之前调用</b>才能比对旧值。新名为空时不应调用。
     * id 即 platform_tenant_user.id，对应 pm_member.user_id。
     */
    @Update("""
        UPDATE pm_member m
        SET name = #{displayName},
            updated_at = now()
        FROM platform_tenant_user u
        WHERE m.user_id = u.id
          AND u.id = #{id}
          AND m.deleted_at IS NULL
          AND m.name IS NOT DISTINCT FROM u.display_name
    """)
    int syncPmMemberName(@Param("id") UUID id, @Param("displayName") String displayName);

    /**
     * 批量查询用户显示名（用于填充 operatorName）
     */
    @Select("""
        <script>
        SELECT id, display_name FROM platform_tenant_user
        WHERE id IN
        <foreach item="uid" collection="ids" open="(" separator="," close=")">
            #{uid}
        </foreach>
        AND deleted_at IS NULL
        </script>
    """)
    List<Map<String, Object>> batchFindDisplayNames(@Param("ids") Collection<UUID> ids);

    // ==================== 团队（platform_team）子团队管理 ====================
    // team = PM 域分组（仅 pm_customer/pm_project 带 team_id）。此 CRUD 为历史代管入口
    // （WMS 设置页 + PM 设置页共用 /app/team/teams/*）；物理表名 platform_team/
    // platform_team_member 保留为跨模块共享的分组载体，不做物理搬迁。

    /**
     * 列出租户下所有团队（含成员数；默认团队置顶）。
     */
    @Select("""
        SELECT t.id, t.tenant_id, t.name, t.color, t.is_default, t.sort_order, t.created_at,
               (SELECT COUNT(*) FROM platform_team_member m
                  WHERE m.team_id = t.id AND m.deleted_at IS NULL) AS member_count
        FROM platform_team t
        WHERE t.tenant_id = #{tenantId} AND t.deleted_at IS NULL
        ORDER BY t.is_default DESC, t.sort_order ASC, t.created_at ASC
    """)
    List<Map<String, Object>> listTeamsByTenant(@Param("tenantId") UUID tenantId);

    /**
     * 查询单个团队（限本租户）。
     */
    @Select("""
        SELECT id, tenant_id, name, color, is_default, sort_order
        FROM platform_team
        WHERE id = #{id} AND tenant_id = #{tenantId} AND deleted_at IS NULL
    """)
    Map<String, Object> findTeamById(@Param("id") UUID id, @Param("tenantId") UUID tenantId);

    /**
     * 统计租户下有效团队数（排序序号 / 门控用）。
     */
    @Select("SELECT COUNT(*) FROM platform_team WHERE tenant_id = #{tenantId} AND deleted_at IS NULL")
    int countTeamsByTenant(@Param("tenantId") UUID tenantId);

    /**
     * 查询租户默认团队 id（FREE/单团队兜底落地用）。
     */
    @Select("""
        SELECT id FROM platform_team
        WHERE tenant_id = #{tenantId} AND is_default = true AND deleted_at IS NULL
        LIMIT 1
    """)
    UUID findDefaultTeamId(@Param("tenantId") UUID tenantId);

    @Insert("""
        INSERT INTO platform_team (id, tenant_id, name, color, is_default, sort_order)
        VALUES (#{id}, #{tenantId}, #{name}, #{color}, false, #{sortOrder})
    """)
    void insertTeam(@Param("id") UUID id, @Param("tenantId") UUID tenantId,
                    @Param("name") String name, @Param("color") String color,
                    @Param("sortOrder") int sortOrder);

    @Update("""
        UPDATE platform_team
        SET name = #{name}, color = #{color}, updated_at = now()
        WHERE id = #{id} AND tenant_id = #{tenantId} AND deleted_at IS NULL
    """)
    void updateTeam(@Param("id") UUID id, @Param("tenantId") UUID tenantId,
                    @Param("name") String name, @Param("color") String color);

    @Update("""
        UPDATE platform_team SET deleted_at = now(), updated_at = now()
        WHERE id = #{id} AND tenant_id = #{tenantId} AND deleted_at IS NULL
    """)
    void softDeleteTeam(@Param("id") UUID id, @Param("tenantId") UUID tenantId);

    /** 删除团队时一并软删其成员关系。 */
    @Update("""
        UPDATE platform_team_member SET deleted_at = now()
        WHERE team_id = #{teamId} AND deleted_at IS NULL
    """)
    void softDeleteTeamMembers(@Param("teamId") UUID teamId);

    /** 团队下有效项目数（非空删除守卫）。 */
    @Select("SELECT COUNT(*) FROM pm_project WHERE team_id = #{teamId} AND deleted_at IS NULL")
    int countProjectsInTeam(@Param("teamId") UUID teamId);

    /** 团队下有效客户数（非空删除守卫）。 */
    @Select("SELECT COUNT(*) FROM pm_customer WHERE team_id = #{teamId} AND deleted_at IS NULL")
    int countCustomersInTeam(@Param("teamId") UUID teamId);

    // ---- 团队成员（platform_team_member）----

    /** 团队成员（展开 tenant_user 信息）。 */
    @Select("""
        SELECT tu.id AS tenant_user_id, tu.display_name, tu.role, tu.is_enabled
        FROM platform_team_member m
        JOIN platform_tenant_user tu ON tu.id = m.tenant_user_id AND tu.deleted_at IS NULL
        WHERE m.team_id = #{teamId} AND m.deleted_at IS NULL
        ORDER BY tu.created_at ASC
    """)
    List<Map<String, Object>> listTeamMemberUsers(@Param("teamId") UUID teamId);

    /** 团队当前成员的 tenant_user_id 列表（差量比对用）。 */
    @Select("""
        SELECT tenant_user_id FROM platform_team_member
        WHERE team_id = #{teamId} AND deleted_at IS NULL
    """)
    List<UUID> listTeamMemberIds(@Param("teamId") UUID teamId);

    @Insert("""
        INSERT INTO platform_team_member (id, tenant_id, team_id, tenant_user_id)
        VALUES (#{id}, #{tenantId}, #{teamId}, #{userId})
    """)
    void insertTeamMember(@Param("id") UUID id, @Param("tenantId") UUID tenantId,
                          @Param("teamId") UUID teamId, @Param("userId") UUID userId);

    @Update("""
        UPDATE platform_team_member SET deleted_at = now()
        WHERE team_id = #{teamId} AND tenant_user_id = #{userId} AND deleted_at IS NULL
    """)
    void softDeleteTeamMember(@Param("teamId") UUID teamId, @Param("userId") UUID userId);

    /** 校验某 tenant_user 属于本租户。 */
    @Select("""
        SELECT COUNT(*) FROM platform_tenant_user
        WHERE id = #{userId} AND tenant_id = #{tenantId} AND deleted_at IS NULL
    """)
    int countUserInTenant(@Param("userId") UUID userId, @Param("tenantId") UUID tenantId);

    /** 某用户在本租户所属的团队 id 列表（PM 数据可见域；owner 不走此路）。 */
    @Select("""
        SELECT m.team_id FROM platform_team_member m
        JOIN platform_team t ON t.id = m.team_id AND t.deleted_at IS NULL
        WHERE m.tenant_user_id = #{userId} AND m.tenant_id = #{tenantId} AND m.deleted_at IS NULL
    """)
    List<UUID> listTeamIdsByUser(@Param("userId") UUID userId, @Param("tenantId") UUID tenantId);

    /**
     * 本租户所有成员的所属团队（成员列表「所属チーム」列用）。
     * 每行一个 (tenant_user_id, team_id, team_name)，默认团队优先、按排序序号。
     */
    @Select("""
        SELECT m.tenant_user_id, t.id AS team_id, t.name AS team_name
        FROM platform_team_member m
        JOIN platform_team t ON t.id = m.team_id AND t.deleted_at IS NULL
        WHERE m.tenant_id = #{tenantId} AND m.deleted_at IS NULL
        ORDER BY t.is_default DESC, t.sort_order ASC, t.created_at ASC
    """)
    List<Map<String, Object>> listMemberTeams(@Param("tenantId") UUID tenantId);
}

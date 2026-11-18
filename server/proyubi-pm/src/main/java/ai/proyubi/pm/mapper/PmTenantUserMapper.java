package ai.proyubi.pm.mapper;

import ai.proyubi.pm.vo.PmTenantUserVO;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.UUID;

/**
 * 租户用户只读 Mapper（PM）。
 * 直接读平台层 platform_tenant_user，让 PM 成员绑定到与 WMS 共用的同一套租户账户，
 * 避免引入 ops 模块重依赖。
 *
 */
@Mapper
public interface PmTenantUserMapper {

    /** 列出某租户下启用中的全部用户 */
    @Select("""
        select id,
               display_name as "displayName",
               role,
               is_enabled   as "enabled"
        from platform_tenant_user
        where tenant_id = #{tenantId}
          and deleted_at is null
          and is_enabled = true
        order by display_name
        """)
    List<PmTenantUserVO> listByTenant(@Param("tenantId") UUID tenantId);

    /**
     * 可指派 / 可进 PM 的成员 = 拥有有效 pm grant 的启用中租户用户（与 PM 准入网关同源）。
     * 模型 A（③-c）：PM 成员名册收敛到「有 pm grant 的人」，「能被指派」⊆「能进 PM」，
     * 避免把任务指派给进不了 PM 的旧用户；owner 由②回填已发 pm owner grant，照常入选。
     * 历史 pm_task.assignee_ids 指向已无 pm grant 的旧用户仍按快照名显示（不清洗），
     * 只是不可新增指派给他（R3 容忍）。
     */
    @Select("""
        select tu.id,
               tu.display_name as "displayName",
               tu.role,
               tu.is_enabled   as "enabled"
        from platform_tenant_user tu
        join platform_module_grant g
          on g.tenant_user_id = tu.id
         and g.tenant_id      = tu.tenant_id
         and g.module = 'pm'
         and g.status = 'active'
         and g.deleted_at is null
        where tu.tenant_id = #{tenantId}
          and tu.deleted_at is null
          and tu.is_enabled = true
        order by tu.display_name
        """)
    List<PmTenantUserVO> listPmMembersByTenant(@Param("tenantId") UUID tenantId);

    /** 当前用户在本租户的角色（owner/member）。 */
    @Select("""
        select role from platform_tenant_user
        where id = #{userId} and tenant_id = #{tenantId} and deleted_at is null
        """)
    String findRole(@Param("tenantId") UUID tenantId, @Param("userId") UUID userId);

    /** 某用户在本租户的展示名（按主键单行取，替代全量 listByTenant 线性查找）。 */
    @Select("""
        select display_name from platform_tenant_user
        where id = #{userId} and tenant_id = #{tenantId} and deleted_at is null
        """)
    String findDisplayName(@Param("tenantId") UUID tenantId, @Param("userId") UUID userId);

    /** 当前用户在本租户所属的团队 id 列表（多团队可见域）。 */
    @Select("""
        select m.team_id
        from platform_team_member m
        join platform_team t on t.id = m.team_id and t.deleted_at is null
        where m.tenant_user_id = #{userId} and m.tenant_id = #{tenantId} and m.deleted_at is null
        """)
    List<UUID> listTeamIds(@Param("tenantId") UUID tenantId, @Param("userId") UUID userId);

    /** 本租户默认团队 id（兜底落地用）。 */
    @Select("""
        select id from platform_team
        where tenant_id = #{tenantId} and is_default = true and deleted_at is null
        limit 1
        """)
    UUID findDefaultTeamId(@Param("tenantId") UUID tenantId);

    /** 校验某团队属于本租户。 */
    @Select("""
        select count(*) from platform_team
        where id = #{teamId} and tenant_id = #{tenantId} and deleted_at is null
        """)
    int countTeamInTenant(@Param("tenantId") UUID tenantId, @Param("teamId") UUID teamId);
}

package ai.proyubi.account.mapper;

import org.apache.ibatis.annotations.*;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 团队邀请 Mapper
 *
 */
@Mapper
public interface AppInvitationMapper {

    /**
     * 创建邀请。
     */
    @Insert("""
        INSERT INTO platform_invitation
            (id, tenant_id, inviter_user_id, email, display_name, role,
             custom_permissions, message, status, token, expires_at, team_ids)
        VALUES
            (#{id}, #{tenantId}, #{inviterUserId}, lower(#{email}), #{displayName}, #{role},
             #{customPermissions}::jsonb, #{message}, 'pending', #{token}, #{expiresAt}, #{teamIds}::jsonb)
    """)
    void insert(@Param("id") UUID id,
                @Param("tenantId") UUID tenantId,
                @Param("inviterUserId") UUID inviterUserId,
                @Param("email") String email,
                @Param("displayName") String displayName,
                @Param("role") String role,
                @Param("customPermissions") String customPermissions,
                @Param("message") String message,
                @Param("token") String token,
                @Param("expiresAt") OffsetDateTime expiresAt,
                @Param("teamIds") String teamIds);

    /**
     * 根据 ID 查邀请（含 inviter / tenant 信息）。
     */
    @Select("""
        SELECT inv.id, inv.tenant_id, inv.inviter_user_id, inv.email,
               inv.display_name, inv.role, inv.custom_permissions::text AS custom_permissions,
               inv.message, inv.status, inv.token, inv.expires_at, inv.accepted_at,
               inv.accepted_tenant_user_id, inv.created_at,
               inv.team_ids::text AS team_ids,
               iu.display_name AS inviter_name,
               t.name AS tenant_name
        FROM platform_invitation inv
        LEFT JOIN platform_tenant_user iu ON iu.id = inv.inviter_user_id
        LEFT JOIN platform_tenant t ON t.id = inv.tenant_id
        WHERE inv.id = #{id} AND inv.deleted_at IS NULL
    """)
    Map<String, Object> findById(@Param("id") UUID id);

    /**
     * 列出某租户的邀请（按状态过滤；status 传 null 表示返回全部未删除）。
     */
    @Select("""
        <script>
        SELECT inv.id, inv.tenant_id, inv.inviter_user_id, inv.email,
               inv.display_name, inv.role, inv.custom_permissions::text AS custom_permissions,
               inv.message, inv.status, inv.expires_at, inv.accepted_at,
               inv.accepted_tenant_user_id, inv.created_at,
               inv.team_ids::text AS team_ids,
               iu.display_name AS inviter_name
        FROM platform_invitation inv
        LEFT JOIN platform_tenant_user iu ON iu.id = inv.inviter_user_id
        WHERE inv.tenant_id = #{tenantId} AND inv.deleted_at IS NULL
        <if test="status != null">
            AND inv.status = #{status}
        </if>
        ORDER BY inv.created_at DESC
        </script>
    """)
    List<Map<String, Object>> listByTenant(@Param("tenantId") UUID tenantId,
                                           @Param("status") String status);

    /**
     * 查询同租户对同邮箱的 pending 邀请（用于幂等校验）。
     */
    @Select("""
        SELECT inv.id, inv.email, inv.status, inv.expires_at, inv.created_at
        FROM platform_invitation inv
        WHERE inv.tenant_id = #{tenantId}
          AND lower(inv.email) = lower(#{email})
          AND inv.status = 'pending'
          AND inv.deleted_at IS NULL
        LIMIT 1
    """)
    Map<String, Object> findPendingByEmail(@Param("tenantId") UUID tenantId,
                                           @Param("email") String email);

    /**
     * 通过 token 查询邀请（邮件深链：预览 / 接受路径）。
     *
     * <p>含 inviter / tenant 信息及 display_name / message / created_at，供接受页预览渲染。
     */
    @Select("""
        SELECT inv.id, inv.tenant_id, inv.inviter_user_id, inv.email,
               inv.display_name, inv.role, inv.custom_permissions::text AS custom_permissions,
               inv.message, inv.status, inv.expires_at, inv.created_at,
               inv.team_ids::text AS team_ids,
               iu.display_name AS inviter_name,
               t.name AS tenant_name
        FROM platform_invitation inv
        LEFT JOIN platform_tenant_user iu ON iu.id = inv.inviter_user_id
        LEFT JOIN platform_tenant t ON t.id = inv.tenant_id
        WHERE inv.token = #{token} AND inv.deleted_at IS NULL
        LIMIT 1
    """)
    Map<String, Object> findByToken(@Param("token") String token);

    /**
     * 查询某邮箱所有 pending 邀请（被邀请人 inbox 用）。
     */
    @Select("""
        SELECT inv.id, inv.tenant_id, inv.inviter_user_id, inv.email,
               inv.display_name, inv.role, inv.message, inv.status,
               inv.expires_at, inv.created_at,
               iu.display_name AS inviter_name,
               t.name AS tenant_name
        FROM platform_invitation inv
        LEFT JOIN platform_tenant_user iu ON iu.id = inv.inviter_user_id
        LEFT JOIN platform_tenant t ON t.id = inv.tenant_id
        WHERE lower(inv.email) = lower(#{email})
          AND inv.status = 'pending'
          AND inv.expires_at > now()
          AND inv.deleted_at IS NULL
        ORDER BY inv.created_at DESC
    """)
    List<Map<String, Object>> listPendingByEmail(@Param("email") String email);

    /**
     * 检查 email 是否已是该租户成员（不区分启用状态）。
     */
    @Select("""
        SELECT 1
        FROM platform_tenant_user_identity i
        JOIN platform_tenant_user tu ON tu.id = i.tenant_user_id AND tu.deleted_at IS NULL
        WHERE i.identity_type = 'email'
          AND lower(i.identifier) = lower(#{email})
          AND i.deleted_at IS NULL
          AND tu.tenant_id = #{tenantId}
        LIMIT 1
    """)
    Integer existsMemberByEmailInTenant(@Param("tenantId") UUID tenantId,
                                        @Param("email") String email);

    /**
     * 检查 email 在系统中是否已存在（任意租户的 email identity）。
     */
    @Select("""
        SELECT 1
        FROM platform_tenant_user_identity i
        JOIN platform_tenant_user tu ON tu.id = i.tenant_user_id AND tu.deleted_at IS NULL
        WHERE i.identity_type = 'email'
          AND lower(i.identifier) = lower(#{email})
          AND i.deleted_at IS NULL
        LIMIT 1
    """)
    Integer existsAccountByEmail(@Param("email") String email);

    /**
     * 更新邀请状态（pending→accepted/declined/revoked/expired）。
     * 同时维护 accepted_at / accepted_tenant_user_id（仅 accept 时传，其他场景传 null）。
     */
    @Update("""
        <script>
        UPDATE platform_invitation
        SET status = #{status},
            updated_at = now()
            <if test="status == 'accepted'">
                , accepted_at = now()
                , accepted_tenant_user_id = #{acceptedTenantUserId}
            </if>
        WHERE id = #{id} AND deleted_at IS NULL
        </script>
    """)
    int updateStatus(@Param("id") UUID id,
                     @Param("status") String status,
                     @Param("acceptedTenantUserId") UUID acceptedTenantUserId);

    /**
     * 重发邀请：刷新过期时间与 token。
     */
    @Update("""
        UPDATE platform_invitation
        SET expires_at = #{expiresAt},
            token = #{token},
            updated_at = now()
        WHERE id = #{id} AND status = 'pending' AND deleted_at IS NULL
    """)
    int refreshForResend(@Param("id") UUID id,
                         @Param("expiresAt") OffsetDateTime expiresAt,
                         @Param("token") String token);

    /**
     * 批量过期清理：把已过期的 pending 标为 expired。
     */
    @Update("""
        UPDATE platform_invitation
        SET status = 'expired', updated_at = now()
        WHERE status = 'pending' AND expires_at <= now() AND deleted_at IS NULL
    """)
    int markExpired();

    /**
     * 查询邀请人显示名 + 租户名（用于邮件渲染）。
     */
    @Select("""
        SELECT tu.display_name AS inviter_name, t.name AS tenant_name
        FROM platform_tenant_user tu
        LEFT JOIN platform_tenant t ON t.id = tu.tenant_id
        WHERE tu.id = #{inviterUserId} AND tu.deleted_at IS NULL
    """)
    Map<String, Object> findInviterAndTenantInfo(@Param("inviterUserId") UUID inviterUserId);

    /**
     * 接受邀请：在邀请方租户下创建 tenant_user（member 角色，invited_by 指向邀请人）。
     */
    @Insert("""
        INSERT INTO platform_tenant_user
            (id, tenant_id, display_name, role, created_by_owner, invited_by, is_enabled)
        VALUES
            (#{id}, #{tenantId}, #{displayName}, #{role}, false, #{invitedBy}, true)
    """)
    void insertTenantUserFromInvitation(@Param("id") UUID id,
                                        @Param("tenantId") UUID tenantId,
                                        @Param("displayName") String displayName,
                                        @Param("role") String role,
                                        @Param("invitedBy") UUID invitedBy);

    /**
     * 接受邀请：为新 tenant_user 挂一条 email identity（无密码、已验证）。
     *
     * <p>登录时仍走 inviter 原本的 email identity（password_hash 在那一条上）；这条只是"该 email
     * 在该租户下有成员关系"的标记。
     */
    @Insert("""
        INSERT INTO platform_tenant_user_identity
            (id, tenant_user_id, tenant_id, identity_type, identifier,
             password_hash, is_verified, is_enabled)
        VALUES
            (#{id}, #{tenantUserId}, #{tenantId}, 'email', lower(#{email}),
             NULL, true, true)
    """)
    void insertEmailMembershipIdentity(@Param("id") UUID id,
                                       @Param("tenantUserId") UUID tenantUserId,
                                       @Param("tenantId") UUID tenantId,
                                       @Param("email") String email);

    /**
     * 查询某 email 在指定租户的 tenant_user.id（用于已是成员时的幂等返回）。
     */
    @Select("""
        SELECT tu.id
        FROM platform_tenant_user_identity i
        JOIN platform_tenant_user tu ON tu.id = i.tenant_user_id AND tu.deleted_at IS NULL
        WHERE i.identity_type = 'email'
          AND lower(i.identifier) = lower(#{email})
          AND i.deleted_at IS NULL
          AND tu.tenant_id = #{tenantId}
        LIMIT 1
    """)
    UUID findTenantUserIdByEmailInTenant(@Param("tenantId") UUID tenantId,
                                         @Param("email") String email);
}

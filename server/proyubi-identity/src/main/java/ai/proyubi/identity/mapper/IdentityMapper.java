package ai.proyubi.identity.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.Map;
import java.util.UUID;

/**
 * Identity 模块的 DB 操作
 *
 * <p>只封装"身份查找 + 创建租户/用户/身份"这几步；上游编排（find-or-create）由 IdentityService 负责。
 *
 * <p>数据模型约定（OAuth 路径）：一个 tenant_user 同时挂两条 identity：
 * <ul>
 *   <li>{@code identity_type='oauth', identifier='{providerType}:{externalId}'} — 用于 OAuth 回调时查用户</li>
 *   <li>{@code identity_type='email', identifier='{邮箱}'} — 作为 Sa-Token 的 loginId，/me 通过 email 反查</li>
 * </ul>
 */
@Mapper
public interface IdentityMapper {

    /**
     * 通过 OAuth identifier（"google:{sub}"）查找已绑定的用户，并顺带拿 email。
     *
     * <p>字段：tenantUserId / tenantId / email / displayName / userEnabled / tenantStatus。
     */
    @Select("""
        SELECT tu.id AS tenant_user_id, tu.tenant_id, tu.display_name,
               email_i.identifier AS email,
               tu.is_enabled AS user_enabled,
               t.status AS tenant_status
        FROM platform_tenant_user_identity oauth_i
        JOIN platform_tenant_user tu ON tu.id = oauth_i.tenant_user_id AND tu.deleted_at IS NULL
        LEFT JOIN platform_tenant t ON t.id = tu.tenant_id AND t.deleted_at IS NULL
        LEFT JOIN platform_tenant_user_identity email_i
               ON email_i.tenant_user_id = tu.id
              AND email_i.identity_type = 'email'
              AND email_i.deleted_at IS NULL
        WHERE oauth_i.identity_type = 'oauth'
          AND oauth_i.identifier = #{oauthIdentifier}
          AND oauth_i.deleted_at IS NULL
        LIMIT 1
    """)
    Map<String, Object> findByOAuthIdentifier(@Param("oauthIdentifier") String oauthIdentifier);

    /**
     * 通过 email 找到一条已验证的 email identity，用于 OAuth 自动账号合并（策略 A）。
     *
     * <p>仅当 {@code is_verified = true} 才返回，避免攻击者用受害者邮箱抢注未验证账号
     * 后被 OAuth 自动合并。
     *
     * <p>字段：tenantUserId / tenantId / displayName / userEnabled / tenantStatus / email。
     */
    @Select("""
        SELECT tu.id AS tenant_user_id, tu.tenant_id, tu.display_name,
               email_i.identifier AS email,
               tu.is_enabled AS user_enabled,
               t.status AS tenant_status
        FROM platform_tenant_user_identity email_i
        JOIN platform_tenant_user tu ON tu.id = email_i.tenant_user_id AND tu.deleted_at IS NULL
        LEFT JOIN platform_tenant t ON t.id = tu.tenant_id AND t.deleted_at IS NULL
        WHERE email_i.identity_type = 'email'
          AND lower(email_i.identifier) = lower(#{email})
          AND email_i.is_verified = true
          AND email_i.deleted_at IS NULL
        LIMIT 1
    """)
    Map<String, Object> findVerifiedEmailIdentity(@Param("email") String email);

    /**
     * 创建租户
     */
    @Insert("""
        INSERT INTO platform_tenant (id, code, name, region, status)
        VALUES (#{id}, #{code}, #{name}, #{region}, 'active')
    """)
    void insertTenant(@Param("id") UUID id, @Param("code") String code,
                      @Param("name") String name, @Param("region") String region);

    /**
     * 创建租户用户（默认 owner 角色）
     */
    @Insert("""
        INSERT INTO platform_tenant_user (id, tenant_id, display_name, avatar_url, role, is_enabled)
        VALUES (#{id}, #{tenantId}, #{displayName}, #{avatarUrl}, 'owner', true)
    """)
    void insertTenantUser(@Param("id") UUID id, @Param("tenantId") UUID tenantId,
                          @Param("displayName") String displayName,
                          @Param("avatarUrl") String avatarUrl);

    /**
     * 创建 OAuth 身份（无密码）
     */
    @Insert("""
        INSERT INTO platform_tenant_user_identity
            (id, tenant_user_id, tenant_id, identity_type, identifier, password_hash, is_verified, is_enabled)
        VALUES (#{id}, #{tenantUserId}, #{tenantId}, 'oauth', #{identifier}, NULL, true, true)
    """)
    void insertOAuthIdentity(@Param("id") UUID id, @Param("tenantUserId") UUID tenantUserId,
                             @Param("tenantId") UUID tenantId, @Param("identifier") String identifier);

    /**
     * 创建 email 身份（作为 Sa-Token 的 loginId）
     */
    @Insert("""
        INSERT INTO platform_tenant_user_identity
            (id, tenant_user_id, tenant_id, identity_type, identifier, password_hash, is_verified, is_enabled)
        VALUES (#{id}, #{tenantUserId}, #{tenantId}, 'email', #{email}, NULL, #{emailVerified}, true)
    """)
    void insertEmailIdentity(@Param("id") UUID id, @Param("tenantUserId") UUID tenantUserId,
                             @Param("tenantId") UUID tenantId, @Param("email") String email,
                             @Param("emailVerified") boolean emailVerified);

    /**
     * 按邮箱查 email identity —— 账号解析的<b>默认团队</b>（没有切换偏好时用哪个 tenant_user）。
     *
     * <p>一个邮箱可以挂在多个租户下（自己注册的 + 接受邀请加入的），所以这里<b>必须有确定性排序</b>：
     * 按 tenant_user 创建时间取最早的一个（= 自己最先注册的那个租户），id 兜底解决同秒并列。
     * 无 ORDER BY 的 LIMIT 1 会让「同一邮箱登录落到哪个团队」随执行计划漂移，
     * 也会和密码登录的选行结果分叉。
     *
     * <p>返回 tenant_user_id / tenant_id / display_name / is_enabled / user_enabled /
     * tenant_status / deletion_requested_at / force_password_change。
     */
    @Select("""
        SELECT i.id, i.tenant_user_id, i.identifier,
               i.is_enabled, i.force_password_change,
               tu.tenant_id, tu.display_name, tu.is_enabled AS user_enabled,
               t.status AS tenant_status, t.deletion_requested_at
        FROM platform_tenant_user_identity i
        JOIN platform_tenant_user tu ON tu.id = i.tenant_user_id AND tu.deleted_at IS NULL
        LEFT JOIN platform_tenant t ON t.id = tu.tenant_id AND t.deleted_at IS NULL
        WHERE i.identity_type = 'email'
          AND lower(i.identifier) = lower(#{email})
          AND i.deleted_at IS NULL
        ORDER BY tu.created_at ASC, i.id ASC
        LIMIT 1
    """)
    Map<String, Object> findEmailIdentityForLogin(@Param("email") String email);

    /**
     * 登录时按「上次切换的团队」偏好解析目标 tenant_user。
     *
     * <p>返回字段形状与 {@link #findEmailIdentityForLogin(String)} 完全一致，便于直接复用登录编排。
     * 仅当偏好记录存在、对应 email identity 仍有效、tenant_user 启用、租户 active 时才返回；
     * 否则返回 null，由上游回退到默认（首个）团队。
     */
    @Select("""
        SELECT i.id, i.tenant_user_id, i.identifier,
               i.is_enabled, i.force_password_change,
               tu.tenant_id, tu.display_name, tu.is_enabled AS user_enabled,
               t.status AS tenant_status, t.deletion_requested_at
        FROM platform_account_preference p
        JOIN platform_tenant_user tu ON tu.id = p.last_tenant_user_id AND tu.deleted_at IS NULL
        JOIN platform_tenant_user_identity i
               ON i.tenant_user_id = tu.id
              AND i.identity_type = 'email'
              AND i.deleted_at IS NULL
        LEFT JOIN platform_tenant t ON t.id = tu.tenant_id AND t.deleted_at IS NULL
        WHERE lower(p.email) = lower(#{email})
          AND lower(i.identifier) = lower(#{email})
          AND i.is_enabled = true
          AND tu.is_enabled = true
          AND (t.status IS NULL OR t.status = 'active')
        ORDER BY tu.created_at ASC, i.id ASC
        LIMIT 1
    """)
    Map<String, Object> findPreferredTenantUserForLogin(@Param("email") String email);

    /**
     * 模型 A：给新建 owner 发某可售模块的 owner grant（幂等，命中活跃唯一索引
     * {@code uq_module_grant_active} 则跳过）。id/status 用表默认
     * {@code gen_random_uuid()}/{@code 'active'}，无需 setId。
     * 供 Email passwordless 注册（EmailAuthService.createAndLogin）与 Google OAuth 注册
     * （SingleUserAccountModel.createOAuthAccount）两条 owner 创建路径调用
     * （经 ModuleGrantProvisioner 枚举可售模块）。
     */
    @Insert("""
        INSERT INTO platform_module_grant (tenant_id, tenant_user_id, module, role)
        VALUES (#{tenantId}, #{tenantUserId}, #{module}, 'owner')
        ON CONFLICT (tenant_id, tenant_user_id, module) WHERE deleted_at IS NULL DO NOTHING
    """)
    void insertOwnerGrantIfAbsent(@Param("tenantId") UUID tenantId,
                                  @Param("tenantUserId") UUID tenantUserId,
                                  @Param("module") String module);

    /**
     * per-module 计费：给新租户某可售模块发一条 FREE 活跃订阅（幂等，命中活跃唯一索引
     * {@code uq_subscription_active_module} 则跳过）。plan_id 解析到该模块 FREE 套餐
     * （{@code <module>-free}）。供 Email/OAuth 注册路径调用（经 SubscriptionProvisioner 枚举可售模块）。
     */
    @Insert("""
        INSERT INTO platform_subscription (tenant_id, module, plan_type, status, plan_id)
        SELECT #{tenantId}, #{module}, 'FREE', 'active',
               (SELECT id FROM platform_plan
                 WHERE module = #{module} AND code = #{module} || '-free' AND deleted_at IS NULL LIMIT 1)
        ON CONFLICT (tenant_id, module) WHERE status = 'active' DO NOTHING
    """)
    void insertFreeSubscriptionIfAbsent(@Param("tenantId") UUID tenantId,
                                        @Param("module") String module);
}

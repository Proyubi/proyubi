package ai.proyubi.account.mapper;

import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * App 端用户认证 Mapper
 *
 */
@Mapper
public interface AppAuthMapper {

    /**
     * 通过「账号」查找一条可用于<b>校验密码</b>的身份行，包含租户状态。
     *
     * <p>账号既可以是 username（用户名/密码注册的老用户），也可以是 email
     * （邮箱/OAuth 注册后在「设置」里设置了密码的用户）。仅匹配设置了 password_hash
     * 的身份，避免命中纯 passwordless 的 email 行。
     *
     * <p><b>只负责凭据校验，不负责决定登进哪个团队。</b>邮箱可以挂在多个租户下，且
     * {@link #setPasswordByLoginId} 会把同一份哈希写到该邮箱名下所有行，所以本查询选中哪一行
     * 对密码校验没有影响、对「落哪个 tenant_user」也<b>不作数</b>——那一步由
     * {@code AccountTenantResolver} 统一裁决（与邮箱验证码登录同一规则）。
     * 排序仅为让结果稳定可复现。
     */
    @Select("""
        SELECT i.id, i.tenant_user_id, i.identifier, i.identity_type, i.password_hash,
               i.is_enabled, i.force_password_change,
               tu.tenant_id, tu.display_name, tu.is_enabled AS user_enabled,
               t.status AS tenant_status, t.deletion_requested_at
        FROM platform_tenant_user_identity i
        JOIN platform_tenant_user tu ON tu.id = i.tenant_user_id AND tu.deleted_at IS NULL
        LEFT JOIN platform_tenant t ON t.id = tu.tenant_id AND t.deleted_at IS NULL
        WHERE i.identity_type IN ('username', 'email')
          AND lower(i.identifier) = lower(#{username})
          AND i.password_hash IS NOT NULL
          AND i.deleted_at IS NULL
        ORDER BY (i.identity_type = 'username') DESC, tu.created_at ASC, i.id ASC
        LIMIT 1
    """)
    Map<String, Object> findPasswordIdentity(@Param("username") String username);

    /**
     * 检查用户名是否已存在
     */
    @Select("""
        SELECT COUNT(*) FROM platform_tenant_user_identity
        WHERE identity_type = 'username'
          AND lower(identifier) = lower(#{username})
          AND deleted_at IS NULL
    """)
    int countByUsername(@Param("username") String username);

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
     * 创建租户用户（注册时创建，默认 owner 角色）
     */
    @Insert("""
        INSERT INTO platform_tenant_user (id, tenant_id, display_name, role, is_enabled)
        VALUES (#{id}, #{tenantId}, #{displayName}, 'owner', true)
    """)
    void insertTenantUser(@Param("id") UUID id, @Param("tenantId") UUID tenantId,
                          @Param("displayName") String displayName);

    /**
     * 创建用户登录标识
     */
    @Insert("""
        INSERT INTO platform_tenant_user_identity
            (id, tenant_user_id, tenant_id, identity_type, identifier, password_hash, is_verified, is_enabled)
        VALUES (#{id}, #{tenantUserId}, #{tenantId}, 'username', #{identifier}, #{passwordHash}, true, true)
    """)
    void insertIdentity(@Param("id") UUID id, @Param("tenantUserId") UUID tenantUserId,
                        @Param("tenantId") UUID tenantId, @Param("identifier") String identifier,
                        @Param("passwordHash") String passwordHash);

    /**
     * 通过 loginId 查找用户信息（用于 /me 接口），包含租户状态
     * <p>同时匹配 username（密码登录）和 email（OAuth 登录，loginId 为邮箱）两种身份
     * <p>has_password：该 tenant_user 名下是否存在带 password_hash 的 identity（用于前端判断是否显示"修改密码"）
     */
    @Select("""
        SELECT tu.id AS user_id, tu.tenant_id, tu.display_name, tu.avatar_url, tu.role,
               tu.created_at,
               i.identifier AS login_id, i.force_password_change,
               t.status AS tenant_status, t.deletion_requested_at,
               EXISTS(
                 SELECT 1 FROM platform_tenant_user_identity pi
                 WHERE pi.tenant_user_id = tu.id
                   AND pi.password_hash IS NOT NULL
                   AND pi.deleted_at IS NULL
               ) AS has_password,
               (SELECT email_i.identifier
                  FROM platform_tenant_user_identity email_i
                 WHERE email_i.tenant_user_id = tu.id
                   AND email_i.identity_type = 'email'
                   AND email_i.deleted_at IS NULL
                 LIMIT 1) AS email
        FROM platform_tenant_user_identity i
        JOIN platform_tenant_user tu ON tu.id = i.tenant_user_id AND tu.deleted_at IS NULL
        LEFT JOIN platform_tenant t ON t.id = tu.tenant_id AND t.deleted_at IS NULL
        WHERE i.identity_type IN ('username', 'email')
          AND lower(i.identifier) = lower(#{loginId})
          AND i.deleted_at IS NULL
        ORDER BY tu.created_at ASC, i.id ASC
        LIMIT 1
    """)
    Map<String, Object> findUserByLoginId(@Param("loginId") String loginId);

    /**
     * 请求注销账户：设置租户状态为 closing
     */
    @Update("""
        UPDATE platform_tenant
        SET status = 'closing',
            deletion_requested_at = now(),
            updated_at = now()
        WHERE id = #{tenantId}
          AND deleted_at IS NULL
    """)
    int requestDeletion(@Param("tenantId") UUID tenantId);

    /**
     * 撤销注销：恢复租户状态为 active
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
    int cancelDeletion(@Param("tenantId") UUID tenantId);

    /**
     * 通过 loginId 查找密码哈希（用于注销/恢复/改密时的密码验证）。
     *
     * <p>必须同时覆盖 username 和 email 两种身份：邮箱注册的账号在「设置」里设了密码后，
     * 哈希写在 email 身份行上（{@link #setPasswordByLoginId}）。若只查 username，
     * 邮箱账号会永远拿到 null —— 曾导致这类账号<b>无法注销</b>（所有权校验恒失败）。
     *
     * <p>同一 email 跨多租户时各行哈希相同（set 时一并写入），取任意一行即可，
     * ORDER BY 仅为结果稳定 + 避免多行触发 TooManyResultsException。
     */
    @Select("""
        SELECT i.password_hash
        FROM platform_tenant_user_identity i
        JOIN platform_tenant_user tu ON tu.id = i.tenant_user_id AND tu.deleted_at IS NULL
        WHERE i.identity_type IN ('username', 'email')
          AND lower(i.identifier) = lower(#{loginId})
          AND i.password_hash IS NOT NULL
          AND i.deleted_at IS NULL
        ORDER BY (i.identity_type = 'username') DESC, tu.created_at ASC, i.id ASC
        LIMIT 1
    """)
    String findPasswordHashByLoginId(@Param("loginId") String loginId);

    /**
     * 更新表示名（display_name）。传 null 表示清空，前端在有表示名时优先展示，否则回退到账号。
     */
    @Update("""
        UPDATE platform_tenant_user
        SET display_name = #{displayName},
            updated_at = now()
        WHERE id = #{userId}
          AND deleted_at IS NULL
    """)
    int updateDisplayName(@Param("userId") UUID userId, @Param("displayName") String displayName);

    /**
     * 把 PM 成员的甘特显示名（pm_member.name）同步为新的 display_name。
     *
     * <p>pm_member.name 是建成员时从 display_name 拷贝的快照，改表示名后会陈旧。此处仅在该成员名
     * 仍等于「当前（旧）display_name」时才覆盖——即未被手动改成自定义甘特名的成员，借此保护自定义名。
     * <b>必须在 {@link #updateDisplayName} 之前调用</b>，否则 u.display_name 已被改写、无法比对旧值。
     * 新名为空（清空表示名）时不应调用本方法，避免甘特名变空（前端 Member 无邮箱兜底）。
     */
    @Update("""
        UPDATE pm_member m
        SET name = #{newName},
            updated_at = now()
        FROM platform_tenant_user u
        WHERE m.user_id = u.id
          AND u.id = #{userId}
          AND m.deleted_at IS NULL
          AND m.name IS NOT DISTINCT FROM u.display_name
    """)
    int syncPmMemberName(@Param("userId") UUID userId, @Param("newName") String newName);

    /**
     * 写入 / 覆盖密码哈希：把 password_hash 写到 loginId 对应的身份上（设置与修改共用一条）。
     *
     * <p>同时覆盖 username 和 email 两种身份（邮箱/OAuth 用户的 loginId 是 email，身份类型为 email）。
     * 同一 email 跨多租户时一并写入，与「邮箱即账号」的语义一致——一个邮箱账号一个密码。
     */
    @Update("""
        UPDATE platform_tenant_user_identity
        SET password_hash = #{passwordHash}, updated_at = now()
        WHERE identity_type IN ('username', 'email')
          AND lower(identifier) = lower(#{loginId})
          AND deleted_at IS NULL
    """)
    int setPasswordByLoginId(@Param("loginId") String loginId, @Param("passwordHash") String passwordHash);

    /**
     * 清除 force_password_change 标记（username / email 身份通吃）
     */
    @Update("""
        UPDATE platform_tenant_user_identity
        SET force_password_change = false, updated_at = now()
        WHERE identity_type IN ('username', 'email')
          AND lower(identifier) = lower(#{loginId})
          AND deleted_at IS NULL
    """)
    int clearForcePasswordChange(@Param("loginId") String loginId);

    /**
     * 修改密码并清除 force_password_change 标记（username / email 身份通吃）
     */
    @Update("""
        UPDATE platform_tenant_user_identity
        SET password_hash = #{passwordHash}, force_password_change = false, updated_at = now()
        WHERE identity_type IN ('username', 'email')
          AND lower(identifier) = lower(#{loginId})
          AND deleted_at IS NULL
    """)
    int changePasswordAndClearForce(@Param("loginId") String loginId, @Param("passwordHash") String passwordHash);

    /**
     * 查询 force_password_change 标记：该 loginId 名下任一身份被打了标记就算需要改密。
     * 用 bool_or 聚合，避免 email 跨多租户时多行触发 TooManyResultsException。
     */
    @Select("""
        SELECT bool_or(coalesce(force_password_change, false))
        FROM platform_tenant_user_identity
        WHERE identity_type IN ('username', 'email')
          AND lower(identifier) = lower(#{loginId})
          AND deleted_at IS NULL
    """)
    Boolean isForcePasswordChange(@Param("loginId") String loginId);

    /**
     * 通过 tenant_user.id 直接查用户信息（/me 在 multi-tenant 下精确取当前 tenant_user）。
     *
     * <p>语义与 {@link #findUserByLoginId(String)} 一致，但走 user_id 主键，避免 email 出现在
     * 多个租户时 LIMIT 1 命中错误的 tenant_user。
     */
    @Select("""
        SELECT tu.id AS user_id, tu.tenant_id, tu.display_name, tu.avatar_url, tu.role,
               tu.created_at,
               t.status AS tenant_status, t.deletion_requested_at,
               EXISTS(
                 SELECT 1 FROM platform_tenant_user_identity pi
                 WHERE pi.tenant_user_id = tu.id
                   AND pi.password_hash IS NOT NULL
                   AND pi.deleted_at IS NULL
               ) AS has_password,
               (SELECT email_i.identifier
                  FROM platform_tenant_user_identity email_i
                 WHERE email_i.tenant_user_id = tu.id
                   AND email_i.identity_type = 'email'
                   AND email_i.deleted_at IS NULL
                 LIMIT 1) AS email,
               (SELECT bool_or(coalesce(pi.force_password_change, false))
                  FROM platform_tenant_user_identity pi
                 WHERE pi.tenant_user_id = tu.id
                   AND pi.deleted_at IS NULL) AS force_password_change
        FROM platform_tenant_user tu
        LEFT JOIN platform_tenant t ON t.id = tu.tenant_id AND t.deleted_at IS NULL
        WHERE tu.id = #{userId} AND tu.deleted_at IS NULL
    """)
    Map<String, Object> findUserById(@Param("userId") UUID userId);

    /**
     * 列出某 email 名下所有可用团队（启用且租户 active/closing），
     * 用于 /me 的 availableTeams、switch-team 校验。
     */
    @Select("""
        SELECT tu.id AS tenant_user_id, tu.tenant_id, tu.display_name, tu.role,
               tu.is_enabled, tu.created_at,
               t.name AS tenant_name, t.status AS tenant_status
        FROM platform_tenant_user_identity i
        JOIN platform_tenant_user tu ON tu.id = i.tenant_user_id AND tu.deleted_at IS NULL
        LEFT JOIN platform_tenant t ON t.id = tu.tenant_id AND t.deleted_at IS NULL
        WHERE i.identity_type = 'email'
          AND lower(i.identifier) = lower(#{email})
          AND i.deleted_at IS NULL
          AND tu.is_enabled = true
          AND (t.status IS NULL OR t.status IN ('active','closing'))
        ORDER BY tu.created_at ASC
    """)
    List<Map<String, Object>> listAvailableTeamsByEmail(@Param("email") String email);

    /**
     * 记住某账号（邮箱）「上次切换到的团队」，供下次登录优先选用。
     * <p>switch-team 成功后调用；email 已小写。
     */
    @Insert("""
        INSERT INTO platform_account_preference (email, last_tenant_user_id, updated_at)
        VALUES (lower(#{email}), #{tenantUserId}, now())
        ON CONFLICT (email) DO UPDATE
          SET last_tenant_user_id = EXCLUDED.last_tenant_user_id,
              updated_at = now()
    """)
    int upsertAccountPreference(@Param("email") String email,
                               @Param("tenantUserId") UUID tenantUserId);

    /**
     * 模型 A：给新建 owner 发某可售模块的 owner grant（幂等，命中活跃唯一索引
     * {@code uq_module_grant_active} 则跳过）。id/status 用表默认
     * {@code gen_random_uuid()}/{@code 'active'}，无需 setId。
     * 供 {@code AppAuthController.register} 注册路径调用（经 ModuleGrantProvisioner 枚举可售模块）。
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
     * （{@code <module>-free}）。id/created_at 等用表默认值。
     * 供注册路径调用（经 SubscriptionProvisioner 枚举可售模块）。
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

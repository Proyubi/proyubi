package ai.proyubi.account.controller;

import cn.dev33.satoken.stp.SaLoginModel;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.capabilities.module.ModuleGrantProvisioner;
import ai.proyubi.capabilities.module.SubscriptionProvisioner;
import ai.proyubi.common.satoken.stp.StpTenant;
import ai.proyubi.identity.email.EmailVerificationService;
import ai.proyubi.identity.service.AccountTenantResolver;
import ai.proyubi.account.mapper.AppAuthMapper;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.mindrot.jbcrypt.BCrypt;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/app/auth")
@Validated
@RequiredArgsConstructor
public class AppAuthController {

    private final AppAuthMapper authMapper;
    private final AccountTenantResolver tenantResolver;
    private final EmailVerificationService verificationService;
    private final ModuleGrantProvisioner moduleGrantProvisioner;
    private final SubscriptionProvisioner subscriptionProvisioner;

    private static final org.slf4j.Logger log =
            org.slf4j.LoggerFactory.getLogger(AppAuthController.class);

    /** 当前部署区域：决定新建租户写入的 region 字段（与 Email/OAuth 注册路径保持一致） */
    @Value("${app.region:JP}")
    private String region;

    /**
     * 注册新账号（自动创建租户）
     */
    @PostMapping("/register")
    public R<LoginResp> register(@RequestBody @Validated RegisterReq req) {
        // 检查用户名是否已存在
        if (authMapper.countByUsername(req.username) > 0) {
            return R.fail(400, "用户名已存在");
        }

        // 创建租户
        UUID tenantId = UUID.randomUUID();
        String tenantCode = "T" + System.currentTimeMillis();
        String tenantName = req.displayName != null && !req.displayName.isBlank()
                ? req.displayName : req.username;
        String tenantRegion = region != null && !region.isBlank()
                ? region.trim().toUpperCase() : "JP";
        authMapper.insertTenant(tenantId, tenantCode, tenantName, tenantRegion);

        // 创建租户用户
        UUID tenantUserId = UUID.randomUUID();
        authMapper.insertTenantUser(tenantUserId, tenantId, tenantName);

        // 创建登录标识
        UUID identityId = UUID.randomUUID();
        String passwordHash = BCrypt.hashpw(req.password, BCrypt.gensalt());
        authMapper.insertIdentity(identityId, tenantUserId, tenantId, req.username, passwordHash);

        // 模型 A：给新 owner 发齐全部可售模块(wms/pm/bk)的 owner grant，确保模块准入网关放行。
        // register 无 @Transactional；grant 缺失由网关的 owner 绕过兜底，故失败仅记 warn 不阻断登录。
        try {
            moduleGrantProvisioner.ensureOwnerGrants(
                    m -> authMapper.insertOwnerGrantIfAbsent(tenantId, tenantUserId, m));
        } catch (Exception e) {
            log.warn("register: 发放 owner module grant 失败 tenantId={} userId={}: {}",
                    tenantId, tenantUserId, e.getMessage());
        }

        // per-module 计费：给新租户各可售模块发 FREE 订阅（同 grant，缺失由消费方 COALESCE FREE 兜底，故失败仅记 warn）。
        try {
            subscriptionProvisioner.ensureFreeSubscriptions(
                    m -> authMapper.insertFreeSubscriptionIfAbsent(tenantId, m));
        } catch (Exception e) {
            log.warn("register: 发放 FREE 订阅失败 tenantId={}: {}", tenantId, e.getMessage());
        }

        // 自动登录
        StpTenant.STP_LOGIC.login(req.username, new SaLoginModel());
        // 将 tenant_id 和 user_id 存入 SaToken Session，供后续请求使用
        StpTenant.STP_LOGIC.getSession().set("tenant_id", tenantId.toString());
        StpTenant.STP_LOGIC.getSession().set("user_id", tenantUserId.toString());
        String token = StpTenant.STP_LOGIC.getTokenValue();

        return R.ok(new LoginResp(token, req.username, false, null, null, false));
    }

    /**
     * 登录
     */
    @PostMapping("/login")
    public R<LoginResp> login(@RequestBody @Validated LoginReq req) {
        // 1. 凭据校验：找一条带 password_hash 的身份行（只用来验密码，不决定登进哪个团队）
        Map<String, Object> credential = authMapper.findPasswordIdentity(req.username);

        if (credential == null) {
            return R.fail(400, "用户名或密码错误");
        }

        // MyBatis-Flex 的 map-underscore-to-camel-case=true 同时作用于 Map 结果的 key
        String passwordHash = (String) credential.get("passwordHash");
        Boolean isEnabled = (Boolean) credential.get("isEnabled");

        if (passwordHash == null || !BCrypt.checkpw(req.password, passwordHash)) {
            return R.fail(400, "用户名或密码错误");
        }

        if (isEnabled != null && !isEnabled) {
            return R.fail(403, "账号已禁用");
        }

        // 2. 解析落地的 tenant_user。邮箱账号可能挂在多个租户下，必须走与邮箱验证码登录
        //    完全相同的裁决规则（偏好优先 → 默认团队），否则两条路径会登进不同团队。
        //    username 账号是租户内唯一身份，无需解析。
        boolean emailLogin = "email".equals(credential.get("identityType"));
        Map<String, Object> identity = credential;
        if (emailLogin) {
            Map<String, Object> resolved =
                    tenantResolver.resolve((String) credential.get("identifier"));
            if (resolved != null) {
                identity = resolved;
            }
        }

        // 检查用户级别的禁用状态（ops后台禁用）
        Boolean userEnabled = (Boolean) identity.get("userEnabled");
        if (userEnabled != null && !userEnabled) {
            return R.fail(403, "账号已禁用");
        }

        // 检查租户状态
        String tenantStatus = (String) identity.get("tenantStatus");
        boolean accountClosing = "closing".equals(tenantStatus);
        String deletionRequestedAt = null;
        Integer remainingDays = null;

        if (accountClosing) {
            Object deletionTs = identity.get("deletionRequestedAt");
            if (deletionTs != null) {
                Instant requestedAt = toInstant(deletionTs);
                deletionRequestedAt = requestedAt.toString();
                long daysSinceRequest = ChronoUnit.DAYS.between(requestedAt, Instant.now());
                remainingDays = Math.max(0, (int) (30 - daysSinceRequest));
                if (remainingDays <= 0) {
                    return R.fail(403, "账户注销期限已过，无法登录");
                }
            }
        }

        // 登录：用数据库里存的规范 identifier 作为 loginId（与邮箱验证码登录保持同一 loginId 语义）
        String loginIdentifier = identity.get("identifier") != null
                ? (String) identity.get("identifier") : req.username;
        StpTenant.STP_LOGIC.login(loginIdentifier, new SaLoginModel());
        // 将 tenant_id 和 user_id 存入 SaToken Session，供后续请求使用
        Object tenantIdObj = identity.get("tenantId");
        if (tenantIdObj != null) {
            StpTenant.STP_LOGIC.getSession().set("tenant_id", tenantIdObj.toString());
        }
        Object tenantUserIdObj = identity.get("tenantUserId");
        if (tenantUserIdObj != null) {
            StpTenant.STP_LOGIC.getSession().set("user_id", tenantUserIdObj.toString());
        }
        // 邮箱账号用密码登录时，写入 account_email，使其与验证码登录一样能在 /me 列出并切换团队
        if (emailLogin) {
            StpTenant.STP_LOGIC.getSession().set("account_email", loginIdentifier.toLowerCase());
        }

        // 检查是否需要强制修改密码
        Boolean forcePasswordChange = (Boolean) identity.get("forcePasswordChange");
        boolean needChangePassword = forcePasswordChange != null && forcePasswordChange;

        return R.ok(new LoginResp(
                StpTenant.STP_LOGIC.getTokenValue(),
                loginIdentifier,
                accountClosing,
                deletionRequestedAt,
                remainingDays,
                needChangePassword
        ));
    }

    /**
     * 获取当前用户信息。
     *
     * <p>取数策略：优先用 session 的 user_id（multi-tenant 下精确）；
     * 缺失时降级到 loginId 查询（向后兼容旧 username 路径 / 异常 session）。
     */
    @GetMapping("/me")
    public R<MeResp> me() {
        String loginId = (String) StpTenant.STP_LOGIC.getLoginId();
        String userIdStr = (String) StpTenant.STP_LOGIC.getSession().get("user_id");
        String accountEmail = (String) StpTenant.STP_LOGIC.getSession().get("account_email");

        Map<String, Object> user = null;
        if (userIdStr != null) {
            try {
                user = authMapper.findUserById(UUID.fromString(userIdStr));
            } catch (IllegalArgumentException ignore) {
                // session 数据异常，降级到 loginId
            }
        }
        if (user == null) {
            user = authMapper.findUserByLoginId(loginId);
        }

        if (user == null) {
            return R.ok(new MeResp(loginId, loginId, null, null, "member", false, null, null,
                    false, false, null, null, List.of(), null));
        }

        // 检查租户状态
        String tenantStatus = (String) user.get("tenantStatus");
        boolean accountClosing = "closing".equals(tenantStatus);
        String deletionRequestedAt = null;
        Integer remainingDays = null;

        if (accountClosing) {
            Object deletionTs = user.get("deletionRequestedAt");
            if (deletionTs != null) {
                Instant requestedAt = toInstant(deletionTs);
                deletionRequestedAt = requestedAt.toString();
                long daysSinceRequest = ChronoUnit.DAYS.between(requestedAt, Instant.now());
                remainingDays = Math.max(0, (int) (30 - daysSinceRequest));
            }
        }

        String role = user.get("role") != null ? (String) user.get("role") : "member";
        Boolean forceChange = (Boolean) user.get("forcePasswordChange");
        boolean needChangePassword = forceChange != null && forceChange;
        Boolean hasPwd = (Boolean) user.get("hasPassword");
        boolean hasPassword = hasPwd != null && hasPwd;
        String email = (String) user.get("email");
        Object createdTs = user.get("createdAt");
        String createdAt = createdTs != null ? toInstant(createdTs).toString() : null;

        // availableTeams：仅 email/oauth 登录路径会有 account_email；username 路径返回空。
        List<TeamMembership> teams = buildAvailableTeams(accountEmail, userIdStr);

        return R.ok(new MeResp(
                loginId,
                user.get("displayName") != null ? (String) user.get("displayName") : loginId,
                user.get("avatarUrl") != null ? (String) user.get("avatarUrl") : null,
                user.get("tenantId") != null ? user.get("tenantId").toString() : null,
                role,
                accountClosing,
                deletionRequestedAt,
                remainingDays,
                needChangePassword,
                hasPassword,
                email,
                createdAt,
                teams,
                user.get("displayName") != null ? (String) user.get("displayName") : null
        ));
    }

    /**
     * 切换团队（multi-tenant 账号下用）。
     *
     * <p>将 session 的 tenant_id / user_id 改成目标 tenant_user，仍沿用同一个 token；
     * 校验目标 tenant_user 必须挂在当前 session 的 account_email 名下、启用、租户 active。
     */
    @PostMapping("/switch-team")
    public R<MeResp> switchTeam(@RequestBody @Validated SwitchTeamReq req) {
        String accountEmail = (String) StpTenant.STP_LOGIC.getSession().get("account_email");
        if (accountEmail == null || accountEmail.isBlank()) {
            throw BizException.of(403, "当前登录方式不支持切换团队");
        }

        UUID targetUserId;
        try {
            targetUserId = UUID.fromString(req.tenantUserId);
        } catch (IllegalArgumentException e) {
            throw BizException.of(400, "无效的团队ID");
        }

        // 在 availableTeams 里找目标
        List<Map<String, Object>> rows = authMapper.listAvailableTeamsByEmail(accountEmail);
        Map<String, Object> target = null;
        for (Map<String, Object> row : rows) {
            if (targetUserId.equals(row.get("tenantUserId"))) {
                target = row;
                break;
            }
        }
        if (target == null) {
            throw BizException.of(404, "目标团队不存在或无访问权限");
        }

        StpTenant.STP_LOGIC.getSession().set("tenant_id", target.get("tenantId").toString());
        StpTenant.STP_LOGIC.getSession().set("user_id", targetUserId.toString());

        // 持久化偏好：下次登录优先选用该团队（避免再登录回到默认团队）。
        authMapper.upsertAccountPreference(accountEmail.toLowerCase(), targetUserId);

        return me();
    }

    private List<TeamMembership> buildAvailableTeams(String accountEmail, String currentUserIdStr) {
        if (accountEmail == null || accountEmail.isBlank()) {
            return List.of();
        }
        UUID currentUserId = null;
        if (currentUserIdStr != null) {
            try {
                currentUserId = UUID.fromString(currentUserIdStr);
            } catch (IllegalArgumentException ignore) {
                // ignore
            }
        }
        List<Map<String, Object>> rows = authMapper.listAvailableTeamsByEmail(accountEmail);
        List<TeamMembership> result = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            UUID tenantUserId = (UUID) row.get("tenantUserId");
            UUID tenantId = (UUID) row.get("tenantId");
            result.add(new TeamMembership(
                    tenantUserId.toString(),
                    tenantId.toString(),
                    (String) row.get("tenantName"),
                    (String) row.get("displayName"),
                    (String) row.get("role"),
                    tenantUserId.equals(currentUserId)
            ));
        }
        return result;
    }

    /**
     * 登出
     */
    @PostMapping("/logout")
    public R<Void> logout() {
        StpTenant.STP_LOGIC.logout();
        return R.ok(null);
    }

    /**
     * 请求注销账户
     *
     * <p>验证逻辑：
     * <ul>
     *   <li>有密码（用户名/密码注册）：用 password 字段验证</li>
     *   <li>无密码（仅 OAuth 注册）：用 emailConfirmation 字段，要求与账号邮箱完全一致</li>
     * </ul>
     */
    @PostMapping("/delete-account")
    public R<Void> deleteAccount(@RequestBody ConfirmDeleteReq req) {
        String loginId = (String) StpTenant.STP_LOGIC.getLoginId();
        if (!verifyOwnership(loginId, req)) {
            return R.fail(400, "验证失败");
        }

        // 获取租户ID
        String tenantIdStr = (String) StpTenant.STP_LOGIC.getSession().get("tenant_id");
        if (tenantIdStr == null) {
            return R.fail(400, "无法获取租户信息");
        }
        UUID tenantId = UUID.fromString(tenantIdStr);

        // 设置租户状态为 closing
        int updated = authMapper.requestDeletion(tenantId);
        if (updated == 0) {
            return R.fail(400, "操作失败");
        }

        // 登出
        StpTenant.STP_LOGIC.logout();

        return R.ok(null);
    }

    /**
     * 撤销注销（恢复账户）
     */
    @PostMapping("/cancel-deletion")
    public R<Void> cancelDeletion(@RequestBody ConfirmDeleteReq req) {
        String loginId = (String) StpTenant.STP_LOGIC.getLoginId();
        if (!verifyOwnership(loginId, req)) {
            return R.fail(400, "验证失败");
        }

        // 获取租户ID
        String tenantIdStr = (String) StpTenant.STP_LOGIC.getSession().get("tenant_id");
        if (tenantIdStr == null) {
            return R.fail(400, "无法获取租户信息");
        }
        UUID tenantId = UUID.fromString(tenantIdStr);

        // 撤销注销
        int updated = authMapper.cancelDeletion(tenantId);
        if (updated == 0) {
            return R.fail(400, "账户未处于注销状态");
        }

        return R.ok(null);
    }

    /**
     * 高风险操作的所有权校验：有密码则验密码，没密码（OAuth-only）则验邮箱确认
     */
    private boolean verifyOwnership(String loginId, ConfirmDeleteReq req) {
        Map<String, Object> user = authMapper.findUserByLoginId(loginId);
        if (user == null) return false;

        Boolean hasPwd = (Boolean) user.get("hasPassword");
        boolean hasPassword = hasPwd != null && hasPwd;

        if (hasPassword) {
            if (req == null || req.password == null || req.password.isBlank()) return false;
            String passwordHash = authMapper.findPasswordHashByLoginId(loginId);
            return passwordHash != null && BCrypt.checkpw(req.password, passwordHash);
        }

        // OAuth-only：用账号邮箱确认（大小写不敏感）
        String email = (String) user.get("email");
        if (email == null || email.isBlank()) return false;
        if (req == null || req.emailConfirmation == null || req.emailConfirmation.isBlank()) return false;
        return email.equalsIgnoreCase(req.emailConfirmation.trim());
    }

    /**
     * 首次登录修改密码（无需旧密码，仅在 force_password_change=true 时可用）
     */
    @PostMapping("/change-initial-password")
    public R<Void> changeInitialPassword(@RequestBody @Validated NewPasswordReq req) {
        String loginId = (String) StpTenant.STP_LOGIC.getLoginId();

        Boolean forceChange = authMapper.isForcePasswordChange(loginId);
        if (forceChange == null || !forceChange) {
            throw BizException.of(400, "当前账号不需要修改初始密码");
        }

        String passwordHash = BCrypt.hashpw(req.newPassword, BCrypt.gensalt());
        authMapper.changePasswordAndClearForce(loginId, passwordHash);
        return R.ok(null);
    }

    /**
     * 跳过首次登录密码修改
     */
    @PostMapping("/skip-password-change")
    public R<Void> skipPasswordChange() {
        String loginId = (String) StpTenant.STP_LOGIC.getLoginId();
        authMapper.clearForcePasswordChange(loginId);
        return R.ok(null);
    }

    /**
     * 为修改密码发送邮箱验证码。
     *
     * <p>解析当前登录用户绑定的邮箱（与 /me 一致），调用通用验证码服务发送
     * {@code reset_password} 用途的 OTP。账号未绑定邮箱时报错。
     */
    @PostMapping("/password/request-code")
    public R<Void> requestPasswordCode() {
        String email = resolveCurrentUserEmail();
        if (email == null || email.isBlank()) {
            throw BizException.of(400, "メールアドレスが登録されていないため、認証コードを送信できません");
        }
        verificationService.sendCode(email, EmailVerificationService.PURPOSE_RESET_PASSWORD);
        return R.ok();
    }

    /**
     * 修改密码（邮箱验证码为必需；旧密码可选）。
     *
     * <p>旧密码是<b>可选</b>的：邮箱验证码本身已经证明了邮箱归属，所以 wms-web / wms-app /
     * pm-web 的「パスワード変更」都不再要求填写现在的密码 —— Google 注册的账号本来就没有
     * 密码，强制旧密码会让这类账号永远改不了密码。字段保留只为兼容还在传它的老客户端：
     * 传了就照旧校验，不传则仅凭邮箱验证码修改。
     *
     * <p>校验顺序：先验旧密码（若传了），再验邮箱验证码（命中即消费），最后写密码哈希。
     * 这样旧密码错误时不会消耗用户的验证码。
     *
     * <p>无密码账号（邮箱/OAuth 注册）走同一入口：跳过旧密码校验，用
     * {@link AppAuthMapper#setPasswordByLoginId} 写入（username / email 身份通吃）。
     */
    @PutMapping("/password")
    public R<Void> changePassword(@RequestBody @Validated ChangePasswordReq req) {
        String loginId = (String) StpTenant.STP_LOGIC.getLoginId();

        // 1. 仅当前端传了旧密码时才校验（老的 pm-web 流程）
        String passwordHash = authMapper.findPasswordHashByLoginId(loginId);
        if (req.oldPassword != null && !req.oldPassword.isBlank()) {
            if (passwordHash == null || !BCrypt.checkpw(req.oldPassword, passwordHash)) {
                return R.fail(400, "原密码错误");
            }
        }

        // 2. 验证邮箱验证码（reset_password 用途，命中即消费；失败抛 BizException）
        String email = resolveCurrentUserEmail();
        if (email == null || email.isBlank()) {
            throw BizException.of(400, "メールアドレスが登録されていないため、認証コードを確認できません");
        }
        verificationService.verifyAndConsume(email, req.code, EmailVerificationService.PURPOSE_RESET_PASSWORD);

        // 3. 更新密码哈希（username / email 身份通吃；邮箱跨多租户时各行一并覆盖）
        String newHash = BCrypt.hashpw(req.newPassword, BCrypt.gensalt());
        authMapper.setPasswordByLoginId(loginId, newHash);
        return R.ok(null);
    }

    /**
     * 首次设置密码（无旧密码，仅需邮箱验证码）。
     *
     * <p>面向「无密码」用户：邮箱/OAuth 注册的账号本来没有 password_hash，无法走
     * {@link #changePassword} 的旧密码校验。这里用邮箱验证码（reset_password 用途）证明邮箱归属，
     * 然后把密码写到当前 loginId 对应的身份（OAuth 用户即 email 身份）上。设置后即可用
     * 「邮箱 + 密码」从 /login 登录。
     *
     * <p>若账号已有密码，拒绝并引导走 {@link #changePassword}。
     *
     * <p><b>已无前端调用</b>：{@link #changePassword} 现在同样只要邮箱验证码，无密码账号
     * 直接走那一个入口即可。保留此接口只为兼容可能还在调它的老客户端。
     */
    @PutMapping("/password/set")
    public R<Void> setPassword(@RequestBody @Validated SetPasswordReq req) {
        String loginId = (String) StpTenant.STP_LOGIC.getLoginId();

        // 1. 已有密码的账号不能走此接口，必须用旧密码修改
        Map<String, Object> user = authMapper.findUserByLoginId(loginId);
        Boolean hasPwd = user != null ? (Boolean) user.get("hasPassword") : null;
        if (hasPwd != null && hasPwd) {
            throw BizException.of(400, "当前账号已设置密码，请使用「修改密码」功能");
        }

        // 2. 验证邮箱验证码（reset_password 用途，命中即消费；失败抛 BizException）
        String email = resolveCurrentUserEmail();
        if (email == null || email.isBlank()) {
            throw BizException.of(400, "メールアドレスが登録されていないため、認証コードを確認できません");
        }
        verificationService.verifyAndConsume(email, req.code, EmailVerificationService.PURPOSE_RESET_PASSWORD);

        // 3. 写入密码哈希到 loginId 对应身份（email/username 通吃）
        String newHash = BCrypt.hashpw(req.newPassword, BCrypt.gensalt());
        authMapper.setPasswordByLoginId(loginId, newHash);
        return R.ok(null);
    }

    /**
     * 更新个人资料（目前仅表示名 display_name）。
     *
     * <p>传空字符串 / null 视为清空表示名，之后前端回退展示账号。
     */
    @PutMapping("/profile")
    public R<Void> updateProfile(@RequestBody @Validated UpdateProfileReq req) {
        UUID userId = resolveCurrentUserId();
        if (userId == null) {
            return R.fail(400, "用户会话异常，请重新登录");
        }
        String displayName = req.displayName == null ? null : req.displayName.trim();
        if (displayName != null && displayName.isEmpty()) {
            displayName = null;
        }
        // 先同步 PM 甘特显示名（必须在改 display_name 之前，才能比对旧值）；清空表示名时不动 pm_member.name
        if (displayName != null) {
            authMapper.syncPmMemberName(userId, displayName);
        }
        authMapper.updateDisplayName(userId, displayName);
        return R.ok(null);
    }

    // --- Helper ---

    /** 解析当前登录用户的 tenant_user id：优先 session 的 user_id，缺失时按 loginId 兜底。 */
    private UUID resolveCurrentUserId() {
        String userIdStr = (String) StpTenant.STP_LOGIC.getSession().get("user_id");
        if (userIdStr != null) {
            try {
                return UUID.fromString(userIdStr);
            } catch (IllegalArgumentException ignore) {
                // session 数据异常，降级到 loginId
            }
        }
        String loginId = (String) StpTenant.STP_LOGIC.getLoginId();
        Map<String, Object> user = authMapper.findUserByLoginId(loginId);
        if (user != null && user.get("userId") != null) {
            try {
                return UUID.fromString(user.get("userId").toString());
            } catch (IllegalArgumentException ignore) {
                // ignore
            }
        }
        return null;
    }

    /**
     * 解析当前登录用户绑定的邮箱（与 {@link #me()} 取数路径一致）：
     * 优先用 session 的 user_id 走 {@code findUserById}，缺失/异常时降级到 loginId。
     * 用户未绑定 email identity 时返回 null。
     */
    private String resolveCurrentUserEmail() {
        String userIdStr = (String) StpTenant.STP_LOGIC.getSession().get("user_id");
        Map<String, Object> user = null;
        if (userIdStr != null) {
            try {
                user = authMapper.findUserById(UUID.fromString(userIdStr));
            } catch (IllegalArgumentException ignore) {
                // session 数据异常，降级到 loginId
            }
        }
        if (user == null) {
            String loginId = (String) StpTenant.STP_LOGIC.getLoginId();
            user = authMapper.findUserByLoginId(loginId);
        }
        if (user == null) {
            return null;
        }
        return (String) user.get("email");
    }

    private static Instant toInstant(Object ts) {
        if (ts instanceof Timestamp t) {
            return t.toInstant();
        }
        if (ts instanceof java.time.OffsetDateTime odt) {
            return odt.toInstant();
        }
        return Instant.parse(ts.toString());
    }

    // --- Request/Response Records ---

    public record LoginReq(@NotBlank String username, @NotBlank String password) {}

    public record RegisterReq(
            @NotBlank @Size(min = 3, max = 30) String username,
            @NotBlank @Size(min = 6, max = 50) String password,
            String displayName
    ) {}

    public record PasswordReq(@NotBlank String password) {}

    /**
     * 高风险操作（注销/撤销注销）确认请求：二选一
     * <ul>
     *   <li>有密码用户：填 password</li>
     *   <li>OAuth-only 用户：填 emailConfirmation（== 账号邮箱）</li>
     * </ul>
     */
    public record ConfirmDeleteReq(String password, String emailConfirmation) {}

    public record NewPasswordReq(
            @NotBlank @Size(min = 6, max = 50) String newPassword
    ) {}

    /** oldPassword 可选：传了就校验，不传则仅凭邮箱验证码修改。 */
    public record ChangePasswordReq(
            String oldPassword,
            @NotBlank @Size(min = 6, max = 50) String newPassword,
            @NotBlank @Size(min = 6, max = 6) String code
    ) {}

    public record SetPasswordReq(
            @NotBlank @Size(min = 6, max = 50) String newPassword,
            @NotBlank @Size(min = 6, max = 6) String code
    ) {}

    public record UpdateProfileReq(
            @Size(max = 50) String displayName
    ) {}

    public record LoginResp(
            String token,
            String loginId,
            boolean accountClosing,
            String deletionRequestedAt,
            Integer remainingDays,
            boolean forcePasswordChange
    ) {}

    public record MeResp(
            String loginId,
            String name,
            String avatar,
            String tenantId,
            String role,
            boolean accountClosing,
            String deletionRequestedAt,
            Integer remainingDays,
            boolean forcePasswordChange,
            boolean hasPassword,
            String email,
            String createdAt,
            List<TeamMembership> availableTeams,
            String displayName
    ) {}

    public record TeamMembership(
            String tenantUserId,
            String tenantId,
            String tenantName,
            String displayName,
            String role,
            boolean isCurrent
    ) {}

    public record SwitchTeamReq(@NotBlank String tenantUserId) {}
}

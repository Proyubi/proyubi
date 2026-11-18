package ai.proyubi.identity.email;

import ai.proyubi.capabilities.module.ModuleGrantProvisioner;
import ai.proyubi.capabilities.module.SubscriptionProvisioner;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.identity.authprovider.AuthResult;
import ai.proyubi.identity.mapper.IdentityMapper;
import ai.proyubi.identity.service.AccountTenantResolver;
import ai.proyubi.regions.region.Region;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.UUID;

/**
 * 邮箱 Passwordless 认证：注册和登录共用同一条路径。
 *
 * <p>流程：用户填邮箱 → 后端 OTP 入库 + 发邮件 → 用户填验证码 →
 * 验证码正确则 find-or-create user 并登录（已有账号直接登录，没有则创建新租户/用户）。
 *
 * <p>find-or-create 的查找键 = email identity，与策略 A 的 OAuth 自动合并对齐：
 * 同一邮箱无论先用哪种方式注册，最终都是同一个账号。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EmailAuthService {

    private final IdentityMapper identityMapper;
    private final AccountTenantResolver tenantResolver;
    private final EmailVerificationService verificationService;
    private final ModuleGrantProvisioner moduleGrantProvisioner;
    private final SubscriptionProvisioner subscriptionProvisioner;

    /**
     * 校验 OTP，命中则登录已有账号；没有则新建账号后登录。
     */
    @Transactional
    public AuthResult verifyAndAuthenticate(String email, String code, Region region) {
        String normalized = normalizeEmail(email);

        verificationService.verifyAndConsume(
            normalized, code, EmailVerificationService.PURPOSE_LOGIN);

        // 落到哪个团队由 AccountTenantResolver 统一裁决（偏好优先，失效则回退默认团队），
        // 与邮箱+密码登录共用同一规则，避免两条路径登进不同团队。
        Map<String, Object> existing = tenantResolver.resolve(normalized);
        if (existing != null) {
            return loginExisting(existing, normalized);
        }
        return createAndLogin(normalized, region);
    }

    private AuthResult loginExisting(Map<String, Object> identity, String email) {
        Boolean identityEnabled = (Boolean) identity.get("isEnabled");
        if (identityEnabled != null && !identityEnabled) {
            throw BizException.of(403, "账号已禁用");
        }
        Boolean userEnabled = (Boolean) identity.get("userEnabled");
        if (userEnabled != null && !userEnabled) {
            throw BizException.of(403, "账号已禁用");
        }
        String tenantStatus = (String) identity.get("tenantStatus");
        if ("closing".equals(tenantStatus)) {
            throw BizException.of(403, "账号已申请注销");
        }

        UUID tenantUserId = UUID.fromString(identity.get("tenantUserId").toString());
        UUID tenantId = UUID.fromString(identity.get("tenantId").toString());
        String displayName = (String) identity.get("displayName");
        return AuthResult.success(
            tenantId, tenantUserId, email,
            displayName != null ? displayName : email,
            email, null);
    }

    private AuthResult createAndLogin(String email, Region region) {
        UUID tenantId = UUID.randomUUID();
        UUID tenantUserId = UUID.randomUUID();
        String displayName = email;
        String tenantCode = "E" + System.currentTimeMillis();
        String regionCode = region != null ? region.name() : Region.GLOBAL.name();

        identityMapper.insertTenant(tenantId, tenantCode, displayName, regionCode);
        identityMapper.insertTenantUser(tenantUserId, tenantId, displayName, null);
        // 验证码刚刚通过，邮箱属实可达 → is_verified=true
        identityMapper.insertEmailIdentity(
            UUID.randomUUID(), tenantUserId, tenantId, email, true);

        // 模型 A：给新 owner 发齐全部可售模块(wms/pm/bk)的 owner grant（随本事务提交）。
        moduleGrantProvisioner.ensureOwnerGrants(
            m -> identityMapper.insertOwnerGrantIfAbsent(tenantId, tenantUserId, m));
        // per-module 计费：给各可售模块发 FREE 订阅（随本事务提交）。
        subscriptionProvisioner.ensureFreeSubscriptions(
            m -> identityMapper.insertFreeSubscriptionIfAbsent(tenantId, m));

        log.info("Email passwordless registration: tenantId={} userId={} email={}",
            tenantId, tenantUserId, email);

        return AuthResult.success(
            tenantId, tenantUserId, email, displayName, email, null);
    }

    private static String normalizeEmail(String email) {
        if (email == null || email.isBlank()) {
            throw BizException.of(400, "请输入邮箱");
        }
        String trimmed = email.trim().toLowerCase();
        if (!trimmed.contains("@") || trimmed.length() > 254) {
            throw BizException.of(400, "邮箱格式不正确");
        }
        return trimmed;
    }
}

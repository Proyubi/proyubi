package ai.proyubi.identity.accountmodel;

import ai.proyubi.capabilities.module.ModuleGrantProvisioner;
import ai.proyubi.capabilities.module.SubscriptionProvisioner;
import ai.proyubi.identity.authprovider.OAuthUserProfile;
import ai.proyubi.identity.mapper.IdentityMapper;
import ai.proyubi.regions.region.Region;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * 单用户账号模型
 *
 * <p>一个租户一个用户（Owner）。OAuth 路径：创建 tenant + tenant_user + 两条 identity（oauth + email）。
 *
 */
@Component
@RequiredArgsConstructor
public class SingleUserAccountModel implements AccountModel {

    private final IdentityMapper identityMapper;
    private final ModuleGrantProvisioner moduleGrantProvisioner;
    private final SubscriptionProvisioner subscriptionProvisioner;

    @Override
    public String getType() {
        return "single_user";
    }

    @Override
    @Transactional
    public CreatedAccount createOAuthAccount(OAuthUserProfile profile, Region region) {
        UUID tenantId = UUID.randomUUID();
        UUID tenantUserId = UUID.randomUUID();

        String displayName = (profile.name() != null && !profile.name().isBlank())
            ? profile.name() : profile.email();
        String tenantCode = "G" + System.currentTimeMillis();
        String regionCode = region != null ? region.name() : Region.GLOBAL.name();

        identityMapper.insertTenant(tenantId, tenantCode, displayName, regionCode);
        identityMapper.insertTenantUser(tenantUserId, tenantId, displayName, profile.picture());
        identityMapper.insertOAuthIdentity(
            UUID.randomUUID(), tenantUserId, tenantId, profile.toIdentityIdentifier());
        identityMapper.insertEmailIdentity(
            UUID.randomUUID(), tenantUserId, tenantId, profile.email(), profile.emailVerified());

        // 模型 A：给新 owner 发齐全部可售模块(wms/pm/bk)的 owner grant（随本事务提交）。
        moduleGrantProvisioner.ensureOwnerGrants(
            m -> identityMapper.insertOwnerGrantIfAbsent(tenantId, tenantUserId, m));
        // per-module 计费：给各可售模块发 FREE 订阅（随本事务提交）。
        subscriptionProvisioner.ensureFreeSubscriptions(
            m -> identityMapper.insertFreeSubscriptionIfAbsent(tenantId, m));

        return new CreatedAccount(tenantId, tenantUserId, profile.email());
    }
}

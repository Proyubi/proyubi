package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmCustomer;
import ai.proyubi.pm.mapper.PmCustomerMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 客户/产品Service（PM）
 *
 */
@Service
public class PmCustomerService {

    private final PmCustomerMapper customerMapper;
    private final PmTeamScopeService teamScope;
    private final PmCascadeService cascadeService;

    public PmCustomerService(PmCustomerMapper customerMapper, PmTeamScopeService teamScope,
                             PmCascadeService cascadeService) {
        this.customerMapper = customerMapper;
        this.teamScope = teamScope;
        this.cascadeService = cascadeService;
    }

    /** 列出当前租户、当前用户可见团队的全部客户 */
    public List<PmCustomer> list(UUID tenantId) {
        List<UUID> teamIds = teamScope.visibleTeamIds();
        if (teamIds != null && teamIds.isEmpty()) {
            return List.of();   // member 不属于任何团队
        }
        QueryWrapper query = QueryWrapper.create()
            .where(PmCustomer::getTenantId).eq(tenantId)
            .and(PmCustomer::getDeletedAt).isNull();
        if (teamIds != null) {
            query.and(PmCustomer::getTeamId).in(teamIds);
        }
        query.orderBy(PmCustomer::getCreatedAt, true);
        return customerMapper.selectListByQuery(query);
    }

    public PmCustomer getByIdAndTenant(UUID id, UUID tenantId) {
        PmCustomer customer = customerMapper.selectOneById(id);
        if (customer == null || !customer.getTenantId().equals(tenantId) || customer.getDeletedAt() != null) {
            throw BizException.of(404, "客户不存在");
        }
        teamScope.assertTeamVisible(customer.getTeamId());
        return customer;
    }

    @Transactional
    public PmCustomer create(UUID tenantId, String name, String shortName, UUID teamId, Boolean active) {
        PmCustomer customer = new PmCustomer();
        customer.setId(UUID.randomUUID());
        customer.setTenantId(tenantId);
        customer.setTeamId(teamScope.resolveWriteTeamId(teamId));
        customer.setName(name);
        customer.setShortName(shortName);
        customer.setActive(active == null || active);
        customer.setCreatedAt(LocalDateTime.now());
        customer.setUpdatedAt(LocalDateTime.now());
        customerMapper.insert(customer);
        return customer;
    }

    @Transactional
    public PmCustomer update(UUID id, UUID tenantId, String name, String shortName, Boolean active) {
        PmCustomer customer = getByIdAndTenant(id, tenantId);
        customer.setName(name);
        customer.setShortName(shortName);
        if (active != null) {
            customer.setActive(active);
        }
        customer.setUpdatedAt(LocalDateTime.now());
        customerMapper.update(customer);
        return customer;
    }

    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmCustomer customer = getByIdAndTenant(id, tenantId);
        customer.setDeletedAt(LocalDateTime.now());
        customer.setUpdatedAt(LocalDateTime.now());
        customerMapper.update(customer);
        // 品質管理（スイート／ケース／バグ）は customer 配下 → 一括ソフトデリート
        cascadeService.cascadeCustomerQuality(tenantId, id);
        // 資料（顧客共通 + 配下案件）も customer 配下 → 一括ソフトデリート
        cascadeService.cascadeCustomerDocs(tenantId, id);
    }
}

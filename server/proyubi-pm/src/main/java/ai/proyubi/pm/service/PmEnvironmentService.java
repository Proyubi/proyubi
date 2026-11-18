package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmEnvironment;
import ai.proyubi.pm.mapper.PmEnvironmentMapper;
import ai.proyubi.pm.vo.PmEnvironmentVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 環境マスタ Service（品質管理）。環境は顧客/製品(pm_customer)配下。可視性は customer 経由
 * （PmCustomerService.getByIdAndTenant が租户＋チーム可見性を担保）。バグ票からの参照は
 * environment_id で行い、削除してもバグ側 environment(text) スナップショットは残る（RESTRICT なし）。
 *
 */
@Service
public class PmEnvironmentService {

    private static final int MAX_NAME = 100;
    private static final int MAX_TEXT = 500;

    private final PmEnvironmentMapper environmentMapper;
    private final PmCustomerService customerService;

    public PmEnvironmentService(PmEnvironmentMapper environmentMapper, PmCustomerService customerService) {
        this.environmentMapper = environmentMapper;
        this.customerService = customerService;
    }

    /** 顧客/製品配下の環境一覧（sort_order 昇順）。customer 可視性を担保。 */
    public List<PmEnvironmentVO> list(UUID tenantId, UUID customerId) {
        customerService.getByIdAndTenant(customerId, tenantId);
        return environmentMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmEnvironment::getTenantId).eq(tenantId)
                    .and(PmEnvironment::getCustomerId).eq(customerId)
                    .and(PmEnvironment::getDeletedAt).isNull()
                    .orderBy(PmEnvironment::getSortOrder, true)
                    .orderBy(PmEnvironment::getCreatedAt, true)
            ).stream()
            .map(PmEnvironmentVO::of)
            .toList();
    }

    /** 環境を取得し、所属 customer の可視性を担保（見えなければ 404）。バグ紐付け時に customer 一致検証にも使う。 */
    public PmEnvironment getVisible(UUID id, UUID tenantId) {
        PmEnvironment e = environmentMapper.selectOneById(id);
        if (e == null || !tenantId.equals(e.getTenantId()) || e.getDeletedAt() != null) {
            throw BizException.of(404, "環境が存在しません");
        }
        customerService.getByIdAndTenant(e.getCustomerId(), tenantId); // チーム可見性
        return e;
    }

    /** 環境新規作成（末尾に追加）。 */
    @Transactional
    public PmEnvironmentVO create(UUID tenantId, UUID customerId, String name, String browser, String url) {
        customerService.getByIdAndTenant(customerId, tenantId);
        PmEnvironment e = new PmEnvironment();
        e.setId(UUID.randomUUID());
        e.setTenantId(tenantId);
        e.setCustomerId(customerId);
        e.setName(requireName(name));
        e.setBrowser(trimToNull(browser, MAX_TEXT));
        e.setUrl(trimToNull(url, MAX_TEXT));
        e.setSortOrder(nextSortOrder(tenantId, customerId));
        e.setCreatedAt(LocalDateTime.now());
        e.setUpdatedAt(LocalDateTime.now());
        environmentMapper.insert(e);
        return PmEnvironmentVO.of(e);
    }

    /** 環境更新（部分更新；null=据え置き）。browser/url は空文字でクリア可（明示クリア）。 */
    @Transactional
    public PmEnvironmentVO update(UUID id, UUID tenantId, String name, String browser, String url, Integer sortOrder) {
        PmEnvironment e = getVisible(id, tenantId);
        if (name != null) e.setName(requireName(name));
        if (browser != null) e.setBrowser(trimToNull(browser, MAX_TEXT));
        if (url != null) e.setUrl(trimToNull(url, MAX_TEXT));
        if (sortOrder != null) e.setSortOrder(sortOrder);
        e.setUpdatedAt(LocalDateTime.now());
        // ignoreNulls=false：browser/url の明示クリア（空文字→null）を確実に反映する。
        environmentMapper.update(e, false);
        return PmEnvironmentVO.of(e);
    }

    /** 環境削除（ソフトデリート）。参照中のバグは environment(text) スナップショットを保持するため影響なし。 */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmEnvironment e = getVisible(id, tenantId);
        LocalDateTime now = LocalDateTime.now();
        e.setDeletedAt(now);
        e.setUpdatedAt(now);
        environmentMapper.update(e);
    }

    /** 既存最大 sort_order + 1（無ければ 0）。 */
    private int nextSortOrder(UUID tenantId, UUID customerId) {
        List<PmEnvironment> existing = environmentMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmEnvironment::getTenantId).eq(tenantId)
                .and(PmEnvironment::getCustomerId).eq(customerId)
                .and(PmEnvironment::getDeletedAt).isNull());
        int max = -1;
        for (PmEnvironment e : existing) {
            int so = e.getSortOrder() != null ? e.getSortOrder() : 0;
            if (so > max) max = so;
        }
        return max + 1;
    }

    private String requireName(String name) {
        if (name == null || name.isBlank()) {
            throw BizException.of(400, "区分名は必須です");
        }
        String n = name.trim();
        return n.length() > MAX_NAME ? n.substring(0, MAX_NAME) : n;
    }

    private String trimToNull(String s, int max) {
        if (s == null) return null;
        String t = s.trim();
        if (t.isEmpty()) return null;
        return t.length() > max ? t.substring(0, max) : t;
    }
}

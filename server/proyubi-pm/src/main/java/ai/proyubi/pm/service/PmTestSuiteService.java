package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmTestCase;
import ai.proyubi.pm.domain.PmTestSuite;
import ai.proyubi.pm.mapper.PmTestSuiteMapper;
import ai.proyubi.pm.vo.PmTestSuiteVO;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.update.UpdateChain;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * テストスイート Service（品質管理）。
 * スイートは顧客/製品(pm_customer)配下。可視性は customer 経由（PmCustomerService.getByIdAndTenant が
 * 租户＋チーム可見性を担保）。任意で pm_task へ紐付け可能（task_id、null=未紐付け）。
 * 削除は配下ケース／そのケース発ではないバグには波及しない
 * （バグは独立ライフサイクル；ケースのみカスケードソフトデリート）。
 *
 */
@Service
public class PmTestSuiteService {

    private static final int MAX_NAME = 200;

    private final PmTestSuiteMapper suiteMapper;
    private final PmCustomerService customerService;
    private final PmTaskService taskService;

    public PmTestSuiteService(PmTestSuiteMapper suiteMapper, PmCustomerService customerService,
                              PmTaskService taskService) {
        this.suiteMapper = suiteMapper;
        this.customerService = customerService;
        this.taskService = taskService;
    }

    /** 顧客/製品配下のスイート一覧（sort_order 昇順）。customer 可視性を担保。 */
    public List<PmTestSuiteVO> list(UUID tenantId, UUID customerId) {
        customerService.getByIdAndTenant(customerId, tenantId); // 租户＋チーム可見性
        return suiteMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmTestSuite::getTenantId).eq(tenantId)
                    .and(PmTestSuite::getCustomerId).eq(customerId)
                    .and(PmTestSuite::getDeletedAt).isNull()
                    .orderBy(PmTestSuite::getSortOrder, true)
                    .orderBy(PmTestSuite::getCreatedAt, true)
            ).stream()
            .map(PmTestSuiteVO::of)
            .toList();
    }

    /** 指定タスクに紐づくスイート一覧（Gantt タスクドロワー用）。task 可視性を担保。 */
    public List<PmTestSuite> listByTask(UUID tenantId, UUID taskId) {
        taskService.getVisibleTask(taskId, tenantId);
        return suiteMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTestSuite::getTenantId).eq(tenantId)
                .and(PmTestSuite::getTaskId).eq(taskId)
                .and(PmTestSuite::getDeletedAt).isNull()
                .orderBy(PmTestSuite::getSortOrder, true));
    }

    /** スイートを取得し、所属 customer の可視性を担保（見えなければ 404）。 */
    public PmTestSuite getVisibleSuite(UUID id, UUID tenantId) {
        PmTestSuite s = suiteMapper.selectOneById(id);
        if (s == null || !tenantId.equals(s.getTenantId()) || s.getDeletedAt() != null) {
            throw BizException.of(404, "テストスイートが存在しません");
        }
        customerService.getByIdAndTenant(s.getCustomerId(), tenantId); // チーム可見性
        return s;
    }

    /** スイート新規作成（末尾に追加）。taskId は任意（同租户＋可見なタスクのみ紐付け）。 */
    @Transactional
    public PmTestSuiteVO create(UUID tenantId, UUID customerId, String name, String casePrefix,
                               String description, UUID taskId) {
        customerService.getByIdAndTenant(customerId, tenantId);
        PmTestSuite s = new PmTestSuite();
        s.setId(UUID.randomUUID());
        s.setTenantId(tenantId);
        s.setCustomerId(customerId);
        s.setName(requireName(name));
        s.setCasePrefix(trimToNull(casePrefix));
        s.setDescription(trimToNull(description));
        if (taskId != null) {
            taskService.getVisibleTask(taskId, tenantId);
            s.setTaskId(taskId);
        }
        s.setSortOrder(nextSortOrder(tenantId, customerId));
        s.setCreatedAt(LocalDateTime.now());
        s.setUpdatedAt(LocalDateTime.now());
        suiteMapper.insert(s);
        return PmTestSuiteVO.of(s);
    }

    /** スイート更新（部分更新；null=据え置き。unlinkTask=true でタスク解除）。 */
    @Transactional
    public PmTestSuiteVO update(UUID id, UUID tenantId, String name, String casePrefix,
                               String description, Integer sortOrder, UUID taskId, boolean unlinkTask) {
        PmTestSuite s = getVisibleSuite(id, tenantId);
        if (name != null) s.setName(requireName(name));
        if (casePrefix != null) s.setCasePrefix(trimToNull(casePrefix));
        if (description != null) s.setDescription(trimToNull(description));
        if (sortOrder != null) s.setSortOrder(sortOrder);
        if (unlinkTask) {
            s.setTaskId(null);
        } else if (taskId != null) {
            taskService.getVisibleTask(taskId, tenantId);
            s.setTaskId(taskId);
        }
        s.setUpdatedAt(LocalDateTime.now());
        suiteMapper.update(s);
        return PmTestSuiteVO.of(s);
    }

    /** スイート削除（配下ケースをカスケードソフトデリート）。 */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmTestSuite s = getVisibleSuite(id, tenantId);
        LocalDateTime now = LocalDateTime.now();
        UpdateChain.of(PmTestCase.class)
            .set(PmTestCase::getDeletedAt, now)
            .set(PmTestCase::getUpdatedAt, now)
            .where(PmTestCase::getTenantId).eq(tenantId)
            .and(PmTestCase::getSuiteId).eq(id)
            .and(PmTestCase::getDeletedAt).isNull()
            .update();
        // ケース発のバグは独立ライフサイクル（対応中の可能性）→ 波及させず test_case_id 参照のみ残す。
        s.setDeletedAt(now);
        s.setUpdatedAt(now);
        suiteMapper.update(s);
    }

    /** 既存最大 sort_order + 1（無ければ 0）。 */
    private int nextSortOrder(UUID tenantId, UUID customerId) {
        List<PmTestSuite> existing = suiteMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTestSuite::getTenantId).eq(tenantId)
                .and(PmTestSuite::getCustomerId).eq(customerId)
                .and(PmTestSuite::getDeletedAt).isNull());
        int max = -1;
        for (PmTestSuite s : existing) {
            int so = s.getSortOrder() != null ? s.getSortOrder() : 0;
            if (so > max) max = so;
        }
        return max + 1;
    }

    private String requireName(String name) {
        if (name == null || name.isBlank()) {
            throw BizException.of(400, "スイート名は必須です");
        }
        String n = name.trim();
        return n.length() > MAX_NAME ? n.substring(0, MAX_NAME) : n;
    }

    private String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}

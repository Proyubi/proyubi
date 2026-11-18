package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.domain.PmTestCase;
import ai.proyubi.pm.domain.PmTestSuite;
import ai.proyubi.pm.mapper.PmTenantUserMapper;
import ai.proyubi.pm.mapper.PmTestCaseMapper;
import ai.proyubi.pm.vo.PmQualitySummaryVO;
import ai.proyubi.pm.vo.PmTestCaseVO;
import ai.proyubi.pm.vo.PmTestSuiteVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * テストケース Service（品質管理）。仕様フィールド + 最新実施結果を行に保持（latest-result-on-row）。
 * case_no は seq（スイート内・欠番非再利用）から materialize。並行採番は max+1 → insert → 一意違反1回リトライ。
 *
 */
@Service
public class PmTestCaseService {

    static final Set<String> CATEGORY = Set.of("normal", "abnormal", "boundary");
    static final Set<String> PRIORITY = Set.of("high", "medium", "low");
    /** 実施結果の有効値（null/空=未実施へクリア）。 */
    static final Set<String> RESULT = Set.of("pass", "fail", "na");

    private final PmTestCaseMapper caseMapper;
    private final PmTestSuiteService suiteService;
    private final PmCustomerService customerService;
    private final PmMemberResolver memberResolver;
    private final PmTenantUserMapper tenantUserMapper;

    public PmTestCaseService(PmTestCaseMapper caseMapper, PmTestSuiteService suiteService,
                             PmCustomerService customerService,
                             PmMemberResolver memberResolver, PmTenantUserMapper tenantUserMapper) {
        this.caseMapper = caseMapper;
        this.suiteService = suiteService;
        this.customerService = customerService;
        this.memberResolver = memberResolver;
        this.tenantUserMapper = tenantUserMapper;
    }

    // ============================ 参照 ============================

    /** スイート内ケース一覧（sort_order → seq 昇順）。 */
    public List<PmTestCaseVO> listBySuite(UUID tenantId, UUID suiteId) {
        suiteService.getVisibleSuite(suiteId, tenantId);
        return caseMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmTestCase::getTenantId).eq(tenantId)
                    .and(PmTestCase::getSuiteId).eq(suiteId)
                    .and(PmTestCase::getDeletedAt).isNull()
                    .orderBy(PmTestCase::getSortOrder, true)
                    .orderBy(PmTestCase::getSeq, true)
            ).stream().map(PmTestCaseVO::of).toList();
    }

    /** 顧客/製品横断ケース一覧＋フィルタ（suiteId/result/category/priority/keyword）。 */
    public List<PmTestCaseVO> listByCustomer(UUID tenantId, UUID customerId, UUID suiteId,
                                            String result, String category, String priority, String keyword) {
        customerService.getByIdAndTenant(customerId, tenantId);
        QueryWrapper q = QueryWrapper.create()
            .where(PmTestCase::getTenantId).eq(tenantId)
            .and(PmTestCase::getCustomerId).eq(customerId)
            .and(PmTestCase::getDeletedAt).isNull();
        if (suiteId != null) q.and(PmTestCase::getSuiteId).eq(suiteId);
        if (result != null && !result.isBlank()) {
            if ("untested".equals(result)) {
                q.and(PmTestCase::getResult).isNull();
            } else {
                q.and(PmTestCase::getResult).eq(result);
            }
        }
        if (category != null && !category.isBlank()) q.and(PmTestCase::getCategory).eq(category);
        if (priority != null && !priority.isBlank()) q.and(PmTestCase::getPriority).eq(priority);
        if (keyword != null && !keyword.isBlank()) {
            String kw = "%" + keyword.trim() + "%";
            q.and(w -> { w.where(PmTestCase::getTitle).like(kw)
                .or(PmTestCase::getFeatureMajor).like(kw)
                .or(PmTestCase::getFeatureMinor).like(kw)
                .or(PmTestCase::getCaseNo).like(kw); });
        }
        q.orderBy(PmTestCase::getSuiteId, true)
            .orderBy(PmTestCase::getSortOrder, true)
            .orderBy(PmTestCase::getSeq, true);
        return caseMapper.selectListByQuery(q).stream().map(PmTestCaseVO::of).toList();
    }

    /** タスクに紐づくケース一覧（Gantt タスクドロワー用）。紐付けはスイート単位（suite.task_id）。 */
    public List<PmTestCaseVO> listByTask(UUID tenantId, UUID taskId) {
        List<UUID> suiteIds = suiteService.listByTask(tenantId, taskId).stream()
            .map(PmTestSuite::getId).toList();
        if (suiteIds.isEmpty()) return List.of();
        return caseMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmTestCase::getTenantId).eq(tenantId)
                    .and(PmTestCase::getSuiteId).in(suiteIds)
                    .and(PmTestCase::getDeletedAt).isNull()
                    .orderBy(PmTestCase::getSuiteId, true)
                    .orderBy(PmTestCase::getSeq, true)
            ).stream().map(PmTestCaseVO::of).toList();
    }

    /**
     * 品質サマリー（目次シート相当）。スイート別 + プロジェクト合計の latest-result 集計。
     * executed = pass + fail、消化率 = executed/(total-na)、成功率 = pass/executed。
     */
    public PmQualitySummaryVO summary(UUID tenantId, UUID customerId) {
        customerService.getByIdAndTenant(customerId, tenantId);
        List<PmTestSuiteVO> suites = suiteService.list(tenantId, customerId);
        List<PmTestCase> cases = caseMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTestCase::getTenantId).eq(tenantId)
                .and(PmTestCase::getCustomerId).eq(customerId)
                .and(PmTestCase::getDeletedAt).isNull());
        // suiteId -> mutable counters [total, pass, fail, na]
        Map<UUID, int[]> counters = new LinkedHashMap<>();
        for (PmTestSuiteVO s : suites) {
            counters.put(s.id(), new int[4]);
        }
        int[] all = new int[4];
        for (PmTestCase c : cases) {
            int[] agg = counters.get(c.getSuiteId());
            tally(agg, c.getResult());
            tally(all, c.getResult());
        }
        List<PmQualitySummaryVO.SuiteStat> stats = new ArrayList<>(suites.size());
        for (PmTestSuiteVO s : suites) {
            stats.add(toStat(s.id(), s.name(), counters.get(s.id())));
        }
        return new PmQualitySummaryVO(customerId, stats, toStat(null, null, all));
    }

    private void tally(int[] agg, String result) {
        if (agg == null) return;
        agg[0]++; // total
        if ("pass".equals(result)) agg[1]++;
        else if ("fail".equals(result)) agg[2]++;
        else if ("na".equals(result)) agg[3]++;
    }

    private PmQualitySummaryVO.SuiteStat toStat(UUID suiteId, String name, int[] a) {
        int total = a[0], pass = a[1], fail = a[2], na = a[3];
        int untested = total - pass - fail - na;
        int executed = pass + fail;
        int denom = total - na; // 対象外は消化率の母数から除外
        int executionRate = denom > 0 ? Math.round(executed * 100f / denom) : 0;
        int passRate = executed > 0 ? Math.round(pass * 100f / executed) : 0;
        return new PmQualitySummaryVO.SuiteStat(
            suiteId, name, total, pass, fail, na, untested, executed, executionRate, passRate);
    }

    /** 単体取得（可視性担保）。 */
    public PmTestCase getVisibleCase(UUID id, UUID tenantId) {
        PmTestCase c = caseMapper.selectOneById(id);
        if (c == null || !tenantId.equals(c.getTenantId()) || c.getDeletedAt() != null) {
            throw BizException.of(404, "テストケースが存在しません");
        }
        customerService.getByIdAndTenant(c.getCustomerId(), tenantId); // チーム可見性
        return c;
    }

    public PmTestCaseVO getVO(UUID id, UUID tenantId) {
        return PmTestCaseVO.of(getVisibleCase(id, tenantId));
    }

    // ============================ 作成 ============================

    /** ケース1件作成（seq 自動採番、case_no materialize）。 */
    @Transactional
    public PmTestCaseVO create(UUID tenantId, UUID suiteId, CaseInput in) {
        PmTestSuite suite = suiteService.getVisibleSuite(suiteId, tenantId);
        PmTestCase c = buildFromInput(tenantId, suite, in);
        return PmTestCaseVO.of(insertWithSeq(c, suite, in.caseNo()));
    }

    /** Excel 一括取込：sheet→suite 前提、row→case を採番して bulk insert。取込件数を返す。 */
    @Transactional
    public int batchCreate(UUID tenantId, UUID suiteId, List<CaseInput> rows) {
        if (rows == null || rows.isEmpty()) return 0;
        PmTestSuite suite = suiteService.getVisibleSuite(suiteId, tenantId);
        int next = caseMapper.maxSeq(suiteId) + 1;
        int order = 0;
        for (CaseInput in : rows) {
            PmTestCase c = buildFromInput(tenantId, suite, in);
            Integer parsed = parseSeq(in.caseNo());
            int seq = parsed != null ? parsed : next;
            c.setSeq(seq);
            c.setCaseNo(materializeCaseNo(suite, seq, in.caseNo()));
            c.setSortOrder(order++);
            try {
                caseMapper.insert(c);
            } catch (DuplicateKeyException dup) {
                // 取込内で seq 衝突 → 末尾採番に振り直して再挿入
                c.setId(UUID.randomUUID());
                seq = caseMapper.maxSeq(suiteId) + 1;
                c.setSeq(seq);
                c.setCaseNo(materializeCaseNo(suite, seq, null));
                caseMapper.insert(c);
            }
            next = Math.max(next, seq) + 1;
        }
        return rows.size();
    }

    /** seq を採番して insert。一意違反時は max を読み直して1回リトライ。 */
    private PmTestCase insertWithSeq(PmTestCase c, PmTestSuite suite, String explicitCaseNo) {
        int seq = caseMapper.maxSeq(suite.getId()) + 1;
        c.setSeq(seq);
        c.setCaseNo(materializeCaseNo(suite, seq, explicitCaseNo));
        c.setSortOrder(seq);
        try {
            caseMapper.insert(c);
        } catch (DuplicateKeyException dup) {
            seq = caseMapper.maxSeq(suite.getId()) + 1;
            c.setSeq(seq);
            c.setCaseNo(materializeCaseNo(suite, seq, explicitCaseNo));
            c.setSortOrder(seq);
            c.setId(UUID.randomUUID());
            caseMapper.insert(c);
        }
        return c;
    }

    private PmTestCase buildFromInput(UUID tenantId, PmTestSuite suite, CaseInput in) {
        PmTestCase c = new PmTestCase();
        c.setId(UUID.randomUUID());
        c.setTenantId(tenantId);
        c.setCustomerId(suite.getCustomerId());
        c.setSuiteId(suite.getId());
        c.setFeatureMajor(trimToNull(in.featureMajor()));
        c.setFeatureMinor(trimToNull(in.featureMinor()));
        c.setTitle(requireTitle(in.title()));
        c.setCategory(normCategory(in.category()));
        c.setPriority(normPriority(in.priority()));
        c.setPrecondition(trimToNull(in.precondition()));
        c.setSteps(trimToNull(in.steps()));
        c.setTestData(trimToNull(in.testData()));
        c.setExpected(trimToNull(in.expected()));
        c.setRemark(trimToNull(in.remark()));
        c.setCreatedAt(LocalDateTime.now());
        c.setUpdatedAt(LocalDateTime.now());
        // 取込時に result が来ていれば取り込む（Excel の OK/NG/対象外）。担当/実施日はスタンプせず取込値尊重なし＝現在時刻。
        String r = normResultOrNull(in.result());
        if (r != null) {
            c.setResult(r);
            c.setExecutedAt(LocalDateTime.now());
        }
        return c;
    }

    // ============================ 更新 ============================

    /** ケース仕様フィールド更新（部分更新；null=据え置き）。タスク紐付けはスイート単位のため本 API では扱わない。 */
    @Transactional
    public PmTestCaseVO update(UUID id, UUID tenantId, CaseInput in) {
        PmTestCase c = getVisibleCase(id, tenantId);
        if (in.featureMajor() != null) c.setFeatureMajor(trimToNull(in.featureMajor()));
        if (in.featureMinor() != null) c.setFeatureMinor(trimToNull(in.featureMinor()));
        if (in.title() != null) c.setTitle(requireTitle(in.title()));
        if (in.category() != null) c.setCategory(normCategory(in.category()));
        if (in.priority() != null) c.setPriority(normPriority(in.priority()));
        if (in.precondition() != null) c.setPrecondition(trimToNull(in.precondition()));
        if (in.steps() != null) c.setSteps(trimToNull(in.steps()));
        if (in.testData() != null) c.setTestData(trimToNull(in.testData()));
        if (in.expected() != null) c.setExpected(trimToNull(in.expected()));
        if (in.remark() != null) c.setRemark(trimToNull(in.remark()));
        c.setUpdatedAt(LocalDateTime.now());
        caseMapper.update(c);
        return PmTestCaseVO.of(c);
    }

    /** 実施結果クイック更新1件（result + 実施日/担当を自動スタンプ）。 */
    @Transactional
    public PmTestCaseVO updateResult(UUID id, UUID tenantId, UUID userId, String result) {
        PmTestCase c = getVisibleCase(id, tenantId);
        stampResult(c, tenantId, userId, result);
        caseMapper.update(c);
        return PmTestCaseVO.of(c);
    }

    /** 実施結果一括記録。プロジェクト内の可視ケースのみ対象、更新件数を返す。 */
    @Transactional
    public int batchResult(UUID tenantId, UUID userId, List<UUID> caseIds, String result) {
        if (caseIds == null || caseIds.isEmpty()) return 0;
        int n = 0;
        for (UUID id : caseIds) {
            PmTestCase c = caseMapper.selectOneById(id);
            if (c == null || !tenantId.equals(c.getTenantId()) || c.getDeletedAt() != null) {
                continue; // 不正/越権 id は静默スキップ
            }
            stampResult(c, tenantId, userId, result);
            caseMapper.update(c);
            n++;
        }
        return n;
    }

    /** 論理削除。 */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmTestCase c = getVisibleCase(id, tenantId);
        c.setDeletedAt(LocalDateTime.now());
        c.setUpdatedAt(LocalDateTime.now());
        caseMapper.update(c);
    }

    // ============================ ヘルパ ============================

    private void stampResult(PmTestCase c, UUID tenantId, UUID userId, String result) {
        String r = normResultOrNull(result);
        c.setResult(r);
        if (r == null) {
            // 未実施へ戻す：スタンプもクリア
            c.setExecutedAt(null);
            c.setExecutedBy(null);
            c.setExecutedByName(null);
        } else {
            c.setExecutedAt(LocalDateTime.now());
            c.setExecutedBy(userId);
            c.setExecutedByName(resolveExecutorName(tenantId, userId));
        }
        c.setUpdatedAt(LocalDateTime.now());
    }

    private String resolveExecutorName(UUID tenantId, UUID userId) {
        PmMember m = memberResolver.findMember(tenantId, userId);
        if (m != null && m.getName() != null && !m.getName().isBlank()) {
            return m.getName();
        }
        if (userId != null) {
            String name = tenantUserMapper.findDisplayName(tenantId, userId);
            if (name != null && !name.isBlank()) return name;
        }
        return null;
    }

    /** case_no を確定：明示指定を優先、無ければ prefix + '-' + lpad(seq,3)（prefix 無ければ TC）。 */
    private String materializeCaseNo(PmTestSuite suite, int seq, String explicit) {
        if (explicit != null && !explicit.isBlank()) return explicit.trim();
        String prefix = suite.getCasePrefix();
        if (prefix == null || prefix.isBlank()) prefix = "TC";
        return prefix.trim() + "-" + String.format("%03d", seq);
    }

    /** 末尾数値を seq として解析（例 STU-012 → 12）。解析不能は null。 */
    private Integer parseSeq(String caseNo) {
        if (caseNo == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d+)\\s*$").matcher(caseNo.trim());
        if (m.find()) {
            try {
                return Integer.parseInt(m.group(1));
            } catch (NumberFormatException ignore) {
                return null;
            }
        }
        return null;
    }

    private String requireTitle(String title) {
        if (title == null || title.isBlank()) {
            throw BizException.of(400, "テスト観点（title）は必須です");
        }
        return title.trim();
    }

    private String normCategory(String v) {
        if (v == null || v.isBlank()) return "normal";
        if (!CATEGORY.contains(v)) throw BizException.of(400, "不正な区分：" + v);
        return v;
    }

    private String normPriority(String v) {
        if (v == null || v.isBlank()) return "medium";
        if (!PRIORITY.contains(v)) throw BizException.of(400, "不正な優先度：" + v);
        return v;
    }

    /** 実施結果を正規化。null/空/untested → null（未実施）。それ以外は RESULT で検証。 */
    private String normResultOrNull(String v) {
        if (v == null || v.isBlank() || "untested".equals(v)) return null;
        if (!RESULT.contains(v)) throw BizException.of(400, "不正な実施結果：" + v);
        return v;
    }

    private String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    /** ケース作成/更新の入力（部分更新可；未指定は null）。 */
    public record CaseInput(
        String featureMajor,
        String featureMinor,
        String title,
        String category,
        String priority,
        String precondition,
        String steps,
        String testData,
        String expected,
        String remark,
        String result,
        String caseNo
    ) {}
}

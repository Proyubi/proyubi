package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmBug;
import ai.proyubi.pm.domain.PmEnvironment;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.domain.PmTestCase;
import ai.proyubi.pm.mapper.PmBugMapper;
import ai.proyubi.pm.mapper.PmMemberMapper;
import ai.proyubi.pm.mapper.PmTenantUserMapper;
import ai.proyubi.pm.vo.PmBugVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * バグ票 Service（品質管理）。失敗ケースからの起票 or 単独起票。bug_no は seq（プロジェクト内・欠番非再利用）から
 * materialize。ステータス遷移で resolved_at スタンプ／再オープン時 reopen_count++。
 *
 */
@Service
public class PmBugService {

    static final Set<String> SEVERITY = Set.of("high", "medium", "low");
    static final Set<String> PRIORITY = Set.of("high", "medium", "low");
    static final Set<String> STATUS = Set.of("open", "in_progress", "resolved", "verifying", "closed", "wontfix");
    /** 再オープン扱い：ここから in_progress へ戻すと reopen_count++。 */
    private static final Set<String> CLOSED_LIKE = Set.of("resolved", "verifying", "closed", "wontfix");

    private final PmBugMapper bugMapper;
    private final PmCustomerService customerService;
    private final PmProjectService projectService;
    private final PmTaskService taskService;
    private final PmTestCaseService caseService;
    private final PmTestSuiteService suiteService;
    private final PmEnvironmentService environmentService;
    private final PmMemberResolver memberResolver;
    private final PmMemberMapper memberMapper;
    private final PmTenantUserMapper tenantUserMapper;

    public PmBugService(PmBugMapper bugMapper, PmCustomerService customerService, PmProjectService projectService,
                        PmTaskService taskService, PmTestCaseService caseService, PmTestSuiteService suiteService,
                        PmEnvironmentService environmentService, PmMemberResolver memberResolver,
                        PmMemberMapper memberMapper, PmTenantUserMapper tenantUserMapper) {
        this.bugMapper = bugMapper;
        this.customerService = customerService;
        this.projectService = projectService;
        this.taskService = taskService;
        this.caseService = caseService;
        this.suiteService = suiteService;
        this.environmentService = environmentService;
        this.memberResolver = memberResolver;
        this.memberMapper = memberMapper;
        this.tenantUserMapper = tenantUserMapper;
    }

    // ============================ 参照 ============================

    /** 顧客/製品内バグ一覧＋フィルタ（status/severity/priority/assigneeId/keyword）。 */
    public List<PmBugVO> listByCustomer(UUID tenantId, UUID customerId, String status, String severity,
                                       String priority, UUID assigneeId, String keyword) {
        customerService.getByIdAndTenant(customerId, tenantId);
        QueryWrapper q = QueryWrapper.create()
            .where(PmBug::getTenantId).eq(tenantId)
            .and(PmBug::getCustomerId).eq(customerId)
            .and(PmBug::getDeletedAt).isNull();
        if (status != null && !status.isBlank()) q.and(PmBug::getStatus).eq(status);
        if (severity != null && !severity.isBlank()) q.and(PmBug::getSeverity).eq(severity);
        if (priority != null && !priority.isBlank()) q.and(PmBug::getPriority).eq(priority);
        if (assigneeId != null) q.and(PmBug::getAssigneeMemberId).eq(assigneeId);
        if (keyword != null && !keyword.isBlank()) {
            String kw = "%" + keyword.trim() + "%";
            q.and(w -> { w.where(PmBug::getTitle).like(kw)
                .or(PmBug::getBugNo).like(kw)
                .or(PmBug::getDescription).like(kw); });
        }
        q.orderBy(PmBug::getSeq, false); // 新しい番号が上
        return bugMapper.selectListByQuery(q).stream().map(PmBugVO::of).toList();
    }

    /** タスクに紐づくバグ一覧（Gantt タスクドロワー用）。 */
    public List<PmBugVO> listByTask(UUID tenantId, UUID taskId) {
        taskService.getVisibleTask(taskId, tenantId);
        return bugMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmBug::getTenantId).eq(tenantId)
                    .and(PmBug::getTaskId).eq(taskId)
                    .and(PmBug::getDeletedAt).isNull()
                    .orderBy(PmBug::getSeq, false)
            ).stream().map(PmBugVO::of).toList();
    }

    public PmBug getVisibleBug(UUID id, UUID tenantId) {
        PmBug b = bugMapper.selectOneById(id);
        if (b == null || !tenantId.equals(b.getTenantId()) || b.getDeletedAt() != null) {
            throw BizException.of(404, "バグ票が存在しません");
        }
        customerService.getByIdAndTenant(b.getCustomerId(), tenantId);
        return b;
    }

    public PmBugVO getVO(UUID id, UUID tenantId) {
        return PmBugVO.of(getVisibleBug(id, tenantId));
    }

    // ============================ 作成 ============================

    /** バグ単独起票。 */
    @Transactional
    public PmBugVO create(UUID tenantId, UUID customerId, UUID userId, BugInput in) {
        customerService.getByIdAndTenant(customerId, tenantId);
        PmBug b = baseBug(tenantId, customerId, userId, in);
        applyProjectLink(b, tenantId, customerId, in.projectId(), false);
        applyTaskLink(b, tenantId, in.taskId(), false);
        return PmBugVO.of(insertWithSeq(b, tenantId, customerId));
    }

    /** 失敗ケースからバグ起票（test_case_id 継承、タスクはケースのスイートから継承、title/description 事前充填）。 */
    @Transactional
    public PmBugVO createFromCase(UUID tenantId, UUID caseId, UUID userId, BugInput in) {
        PmTestCase c = caseService.getVisibleCase(caseId, tenantId);
        PmBug b = baseBug(tenantId, c.getCustomerId(), userId, in);
        b.setTestCaseId(c.getId());
        applyProjectLink(b, tenantId, c.getCustomerId(), in.projectId(), false);
        // タスクは明示指定を優先、無ければケースの所属スイートの紐付けタスクを継承
        if (in.taskId() != null) {
            applyTaskLink(b, tenantId, in.taskId(), false);
        } else {
            UUID suiteTaskId = suiteService.getVisibleSuite(c.getSuiteId(), tenantId).getTaskId();
            if (suiteTaskId != null) b.setTaskId(suiteTaskId);
        }
        if (b.getTitle() == null || b.getTitle().isBlank()) {
            b.setTitle("[" + c.getCaseNo() + "] " + (c.getTitle() != null ? c.getTitle() : ""));
        }
        if (b.getDescription() == null || b.getDescription().isBlank()) {
            b.setDescription(prefillDescription(c));
        }
        return PmBugVO.of(insertWithSeq(b, tenantId, c.getCustomerId()));
    }

    private PmBug baseBug(UUID tenantId, UUID customerId, UUID userId, BugInput in) {
        PmBug b = new PmBug();
        b.setId(UUID.randomUUID());
        b.setTenantId(tenantId);
        b.setCustomerId(customerId);
        b.setTitle(trimToNull(in.title()));
        b.setDescription(trimToNull(in.description()));
        b.setSeverity(normSeverity(in.severity()));
        b.setPriority(normPriority(in.priority()));
        b.setStatus(normStatus(in.status(), "open"));
        b.setReopenCount(0);
        applyEnvironment(b, tenantId, in.environmentId(), in.environment(), false);
        applyAssignee(b, tenantId, in.assigneeMemberId());
        b.setReporterUserId(userId);
        b.setReporterName(resolveUserName(tenantId, userId));
        b.setReportedOn(in.reportedOn() != null ? in.reportedOn() : LocalDate.now());
        b.setCreatedAt(LocalDateTime.now());
        b.setUpdatedAt(LocalDateTime.now());
        return b;
    }

    private PmBug insertWithSeq(PmBug b, UUID tenantId, UUID customerId) {
        if (b.getTitle() == null || b.getTitle().isBlank()) {
            throw BizException.of(400, "タイトルは必須です");
        }
        int seq = bugMapper.maxSeq(tenantId, customerId) + 1;
        b.setSeq(seq);
        b.setBugNo("BUG-" + String.format("%03d", seq));
        try {
            bugMapper.insert(b);
        } catch (DuplicateKeyException dup) {
            seq = bugMapper.maxSeq(tenantId, customerId) + 1;
            b.setSeq(seq);
            b.setBugNo("BUG-" + String.format("%03d", seq));
            b.setId(UUID.randomUUID());
            bugMapper.insert(b);
        }
        return b;
    }

    // ============================ 更新 ============================

    /** バグ更新（部分更新；null=据え置き。unlinkTask/unlinkProject=true で解除）。
     *  in.customerId() が現在と異なれば別製品へ移動し、移動先で採番し直す（bug_no が変わる）。
     *  起票日時(createdAt)/完了日時(resolvedAt) は手動上書き可（clearResolvedAt=true で完了日時をクリア）。 */
    @Transactional
    public PmBugVO update(UUID id, UUID tenantId, BugInput in, boolean unlinkTask, boolean unlinkProject,
                          boolean clearAssignee, boolean clearResolvedAt, boolean unlinkEnvironment) {
        PmBug b = getVisibleBug(id, tenantId);
        // 別製品への移動：移動先を検証し、移動先で採番し直す（製品内連番のため）。
        // 旧タスク紐付けは旧製品配下なので移動時に必ず解除する。
        boolean moved = in.customerId() != null && !in.customerId().equals(b.getCustomerId());
        if (moved) {
            moveToCustomer(b, tenantId, in.customerId());
        }
        if (in.title() != null) b.setTitle(requireTitle(in.title()));
        if (in.description() != null) b.setDescription(trimToNull(in.description()));
        if (in.severity() != null) b.setSeverity(normSeverity(in.severity()));
        if (in.priority() != null) b.setPriority(normPriority(in.priority()));
        // 環境：移動先に旧環境は属さないため、移動かつ新環境未指定なら解除する（タスク紐付けと同慣習）
        applyEnvironment(b, tenantId, in.environmentId(), in.environment(),
            unlinkEnvironment || (moved && in.environmentId() == null));
        if (clearAssignee) {
            b.setAssigneeMemberId(null);
            b.setAssigneeName(null);
        } else if (in.assigneeMemberId() != null) {
            applyAssignee(b, tenantId, in.assigneeMemberId());
        }
        applyProjectLink(b, tenantId, b.getCustomerId(), in.projectId(), unlinkProject);
        applyTaskLink(b, tenantId, in.taskId(), unlinkTask || moved);
        // 起票日/完了日時の手動上書き
        if (in.reportedOn() != null) b.setReportedOn(in.reportedOn());
        if (clearResolvedAt) b.setResolvedAt(null);
        else if (in.resolvedAt() != null) b.setResolvedAt(in.resolvedAt());
        b.setUpdatedAt(LocalDateTime.now());
        // ignoreNulls=false：完了日/担当のクリアや紐付け解除（= null 設定）を確実に反映する。
        // 既定の update(b) は MyBatis-Flex が null 列を無視するため、クリアが SQL に乗らない。
        // b は getVisibleBug で全列ロード済みなので、全列 upsert しても他フィールドは据え置き。
        bugMapper.update(b, false);
        return PmBugVO.of(b);
    }

    /** バグ→タスクの一括紐付け／解除。全 id は同一租户・可視のみ。紐付け時はタスク所属の版本にバグの projectId も同期する
     *  （品質一覧はタスクの製品配下に限定されるため製品跨ぎは 400）。unlink=true で選択バグのタスク紐付けを一括解除。 */
    @Transactional
    public int batchLinkTask(UUID tenantId, List<UUID> ids, UUID taskId, boolean unlink) {
        if (ids == null || ids.isEmpty()) return 0;
        UUID targetProjectId = null;
        UUID targetCustomerId = null;
        if (!unlink) {
            if (taskId == null) {
                throw BizException.of(400, "タスクを指定してください");
            }
            PmTask task = taskService.getVisibleTask(taskId, tenantId);
            targetProjectId = task.getProjectId();
            targetCustomerId = projectService.getByIdAndTenant(targetProjectId, tenantId).getCustomerId();
        }
        LocalDateTime now = LocalDateTime.now();
        int n = 0;
        for (UUID id : ids) {
            PmBug b = getVisibleBug(id, tenantId);
            if (unlink) {
                b.setTaskId(null);
            } else {
                if (!b.getCustomerId().equals(targetCustomerId)) {
                    throw BizException.of(400, "タスクとバグの製品が一致しません");
                }
                b.setTaskId(taskId);
                b.setProjectId(targetProjectId); // タスク所属の版本に合わせる
            }
            b.setUpdatedAt(now);
            // ignoreNulls=false：解除（taskId=null）を確実に SQL へ乗せる（update の設計方針と同じ）。
            bugMapper.update(b, false);
            n++;
        }
        return n;
    }

    /** 別製品へ移動：移動先顧客を検証し、移動先内で seq を採番し直す。プロジェクト/タスク紐付けは呼び出し側で再設定/解除。 */
    private void moveToCustomer(PmBug b, UUID tenantId, UUID targetCustomerId) {
        customerService.getByIdAndTenant(targetCustomerId, tenantId); // 存在・可視性・team を検証
        b.setCustomerId(targetCustomerId);
        b.setProjectId(null); // 旧版本は旧製品配下。移動後は入力の projectId で再設定される
        int seq = bugMapper.maxSeq(tenantId, targetCustomerId) + 1;
        b.setSeq(seq);
        b.setBugNo("BUG-" + String.format("%03d", seq));
    }

    /** ステータス遷移。resolved/closed で resolved_at スタンプ、再オープン(→in_progress)で reopen_count++。 */
    @Transactional
    public PmBugVO updateStatus(UUID id, UUID tenantId, String status) {
        PmBug b = getVisibleBug(id, tenantId);
        String next = normStatus(status, null);
        String prev = b.getStatus();
        if ("in_progress".equals(next) && CLOSED_LIKE.contains(prev)) {
            b.setReopenCount((b.getReopenCount() == null ? 0 : b.getReopenCount()) + 1);
            b.setResolvedAt(null); // 再オープンで解決日時をリセット
        }
        if ("resolved".equals(next) || "closed".equals(next)) {
            if (b.getResolvedAt() == null) b.setResolvedAt(LocalDateTime.now());
        }
        b.setStatus(next);
        b.setUpdatedAt(LocalDateTime.now());
        // ignoreNulls=false：再オープン時の resolved_at=null クリアを反映（既定は null 列を無視）。
        bugMapper.update(b, false);
        return PmBugVO.of(b);
    }

    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmBug b = getVisibleBug(id, tenantId);
        b.setDeletedAt(LocalDateTime.now());
        b.setUpdatedAt(LocalDateTime.now());
        bugMapper.update(b);
    }

    // ============================ ヘルパ ============================

    /** プロジェクト紐付け（unlink=true で解除、null=据え置き）。製品(customerId)配下のプロジェクトのみ許可。 */
    private void applyProjectLink(PmBug b, UUID tenantId, UUID customerId, UUID projectId, boolean unlink) {
        if (unlink) {
            b.setProjectId(null);
        } else if (projectId != null) {
            var project = projectService.getByIdAndTenant(projectId, tenantId);
            if (!customerId.equals(project.getCustomerId())) {
                throw BizException.of(400, "プロジェクトが製品に属しません");
            }
            b.setProjectId(projectId);
        }
    }

    private void applyTaskLink(PmBug b, UUID tenantId, UUID taskId, boolean unlink) {
        if (unlink) {
            b.setTaskId(null);
        } else if (taskId != null) {
            taskService.getVisibleTask(taskId, tenantId);
            b.setTaskId(taskId);
        }
    }

    /**
     * 環境の適用。優先順位：解除 > マスタ選択(environmentId) > 自由入力(environment text) > 据え置き。
     * マスタ選択時は合成ラベルを environment スナップショットへコピーし、製品(customerId)一致を検証する。
     * 自由入力（旧・MCP 起票）時はテキストのみ設定し environmentId をクリアする。
     */
    private void applyEnvironment(PmBug b, UUID tenantId, UUID environmentId, String environmentText, boolean unlink) {
        if (unlink) {
            b.setEnvironmentId(null);
            b.setEnvironment(null);
        } else if (environmentId != null) {
            PmEnvironment e = environmentService.getVisible(environmentId, tenantId);
            if (!b.getCustomerId().equals(e.getCustomerId())) {
                throw BizException.of(400, "環境が製品に属しません");
            }
            b.setEnvironmentId(e.getId());
            b.setEnvironment(e.composeLabel());
        } else if (environmentText != null) {
            b.setEnvironment(trimToNull(environmentText));
            b.setEnvironmentId(null);
        }
    }

    private void applyAssignee(PmBug b, UUID tenantId, UUID memberId) {
        if (memberId == null) return;
        PmMember m = memberMapper.selectOneById(memberId);
        if (m == null || !tenantId.equals(m.getTenantId()) || m.getDeletedAt() != null) {
            throw BizException.of(400, "担当メンバーが存在しません");
        }
        b.setAssigneeMemberId(memberId);
        b.setAssigneeName(m.getName());
    }

    private String prefillDescription(PmTestCase c) {
        StringBuilder sb = new StringBuilder();
        if (c.getPrecondition() != null) sb.append("【前提条件】\n").append(c.getPrecondition()).append("\n\n");
        if (c.getSteps() != null) sb.append("【再現手順】\n").append(c.getSteps()).append("\n\n");
        if (c.getTestData() != null) sb.append("【テストデータ】\n").append(c.getTestData()).append("\n\n");
        if (c.getExpected() != null) sb.append("【期待結果】\n").append(c.getExpected()).append("\n\n");
        sb.append("【実際の結果】\n");
        return sb.toString();
    }

    private String resolveUserName(UUID tenantId, UUID userId) {
        PmMember m = memberResolver.findMember(tenantId, userId);
        if (m != null && m.getName() != null && !m.getName().isBlank()) return m.getName();
        if (userId != null) {
            String name = tenantUserMapper.findDisplayName(tenantId, userId);
            if (name != null && !name.isBlank()) return name;
        }
        return null;
    }

    private String requireTitle(String title) {
        if (title == null || title.isBlank()) throw BizException.of(400, "タイトルは必須です");
        return title.trim();
    }

    private String normSeverity(String v) {
        if (v == null || v.isBlank()) return "medium";
        if (!SEVERITY.contains(v)) throw BizException.of(400, "不正な影響度：" + v);
        return v;
    }

    private String normPriority(String v) {
        if (v == null || v.isBlank()) return "medium";
        if (!PRIORITY.contains(v)) throw BizException.of(400, "不正な優先度：" + v);
        return v;
    }

    private String normStatus(String v, String fallback) {
        if (v == null || v.isBlank()) {
            if (fallback != null) return fallback;
            throw BizException.of(400, "ステータスは必須です");
        }
        if (!STATUS.contains(v)) throw BizException.of(400, "不正なステータス：" + v);
        return v;
    }

    private String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }

    /** バグ作成/更新の入力。 */
    public record BugInput(
        String title,
        String description,
        String severity,
        String priority,
        String status,
        String environment,
        /** 環境マスタ参照（null=マスタ未選択；environment テキストとの併用は environment を優先しない） */
        UUID environmentId,
        UUID assigneeMemberId,
        UUID projectId,
        UUID taskId,
        /** 移動先製品（update 時のみ；null=製品変更なし）。create ではパス変数を使うため無視 */
        UUID customerId,
        /** 起票日の手動上書き（日付のみ；null=据え置き。create 時は未指定なら当日） */
        LocalDate reportedOn,
        /** 完了日時の手動上書き（update 時のみ；null=据え置き、clearResolvedAt でクリア） */
        LocalDateTime resolvedAt
    ) {}
}

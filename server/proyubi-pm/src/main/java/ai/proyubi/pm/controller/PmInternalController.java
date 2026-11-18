package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmCustomer;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.domain.PmMcpToken;
import ai.proyubi.pm.service.PmBugService;
import ai.proyubi.pm.service.PmBugService.BugInput;
import ai.proyubi.pm.service.PmCustomerService;
import ai.proyubi.pm.service.PmMcpTokenService;
import ai.proyubi.pm.service.PmMemberService;
import ai.proyubi.pm.service.PmOverviewService;
import ai.proyubi.pm.service.PmProjectService;
import ai.proyubi.pm.service.PmTaskService;
import ai.proyubi.pm.service.PmWorkloadService;
import ai.proyubi.pm.vo.PmBugVO;
import ai.proyubi.pm.vo.PmOverviewVO;
import ai.proyubi.pm.vo.PmWorkloadItemVO;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 机械用内部接口 Controller（/internal/pm）。
 *
 * 供 MCP / 外部自动化按 API-Key + X-Tenant-Id 调用，复用既有 PmTaskService 等服务，
 * rollup / progress / cascade 均走原有逻辑。鉴权与租户上下文由 InternalApiKeyInterceptor 负责。
 *
 */
@RestController
@RequestMapping("/internal/pm")
@Validated
public class PmInternalController {

    private final PmTaskService taskService;
    private final PmProjectService projectService;
    private final PmCustomerService customerService;
    private final PmOverviewService overviewService;
    private final PmWorkloadService workloadService;
    private final PmMcpTokenService mcpTokenService;
    private final PmMemberService memberService;
    private final PmBugService bugService;

    public PmInternalController(PmTaskService taskService, PmProjectService projectService,
                               PmCustomerService customerService, PmOverviewService overviewService,
                               PmWorkloadService workloadService, PmMcpTokenService mcpTokenService,
                               PmMemberService memberService, PmBugService bugService) {
        this.taskService = taskService;
        this.projectService = projectService;
        this.customerService = customerService;
        this.overviewService = overviewService;
        this.workloadService = workloadService;
        this.mcpTokenService = mcpTokenService;
        this.memberService = memberService;
        this.bugService = bugService;
    }

    /**
     * MCP 令牌反查（pm-mcp 服务端用）：token → tenantId。
     * 令牌本身即密钥，全局按 token 查（不依赖 X-Tenant-Id；调用方发的 tenant 头仅为过拦截器，此处忽略）。
     * 无效令牌返回 401，pm-mcp 据此拒绝该连接。
     */
    @GetMapping("/mcp/resolve")
    public R<McpResolveResult> resolveMcpToken(@RequestParam String token) {
        PmMcpToken t = mcpTokenService.resolve(token);
        if (t == null) {
            throw BizException.of(401, "无效的 MCP 令牌");
        }
        return R.ok(new McpResolveResult(t.getTenantId().toString(), t.getUserId().toString()));
    }

    /** 顧客/製品一覧（名前→ID 解決）。バグ起票は製品配下なので、まずここで customerId を引く。 */
    @GetMapping("/customers")
    public R<List<CustomerItem>> listCustomers(@RequestParam(required = false) String q) {
        String keyword = q == null ? null : q.trim().toLowerCase();
        boolean hasKeyword = keyword != null && !keyword.isEmpty();

        List<CustomerItem> result = new ArrayList<>();
        for (PmCustomer c : customerService.list(getTenantId())) {
            if (hasKeyword) {
                String name = c.getName() == null ? "" : c.getName().toLowerCase();
                String shortName = c.getShortName() == null ? "" : c.getShortName().toLowerCase();
                if (!name.contains(keyword) && !shortName.contains(keyword)) {
                    continue;
                }
            }
            result.add(new CustomerItem(c.getId(), c.getName(), c.getShortName(), c.getActive()));
        }
        return R.ok(result);
    }

    /** 成员一覧（担当名→memberId 解決）。assigneeIds / バグ担当の指定に使う。 */
    @GetMapping("/members")
    public R<List<MemberItem>> listMembers() {
        List<MemberItem> result = new ArrayList<>();
        for (PmMember m : memberService.list(getTenantId())) {
            result.add(new MemberItem(m.getId(), m.getName(), m.getRole()));
        }
        return R.ok(result);
    }

    /** 项目检索（名前→ID 解决）。q 模糊匹配项目名：trim + 大小写不敏感。 */
    @GetMapping("/projects")
    public R<List<ProjectItem>> listProjects(@RequestParam(required = false) String q) {
        UUID tenantId = getTenantId();
        String keyword = q == null ? null : q.trim().toLowerCase();
        boolean hasKeyword = keyword != null && !keyword.isEmpty();

        // 客户名缓存（id → name），避免逐项目查库
        Map<UUID, String> customerNames = new HashMap<>();
        for (PmCustomer c : customerService.list(tenantId)) {
            customerNames.put(c.getId(), c.getName());
        }

        List<ProjectItem> result = new ArrayList<>();
        for (PmProject p : projectService.list(tenantId, null, null, null)) {
            if (hasKeyword) {
                String name = p.getName() == null ? "" : p.getName().toLowerCase();
                if (!name.contains(keyword)) {
                    continue;
                }
            }
            result.add(new ProjectItem(
                p.getId(),
                p.getName(),
                p.getCustomerId(),
                customerNames.get(p.getCustomerId()),
                p.getParentId()
            ));
        }
        return R.ok(result);
    }

    /** 项目任务列表（summary 已汇总），复用既有 listByProject。 */
    @GetMapping("/projects/{projectId}/tasks")
    public R<List<PmTask>> listTasks(@PathVariable UUID projectId) {
        return R.ok(taskService.listByProject(getTenantId(), projectId));
    }

    /**
     * 风险俯瞰（全社）。复用 PmOverviewService，服务端算好 KPI + 风险一览
     * （overdue/behind/blocked/due-soon/unassigned）+ 项目健康 + 近期里程碑。
     * 固定 scope=all：userId は明示 null を渡す（X-User-Id があっても「本人」解釈はしない。
     * 俯瞰は全社ビューという契約を保つため）。チーム可視域は Service 側で TenantContext 基準に効く。
     */
    @GetMapping("/overview")
    public R<PmOverviewVO> overview() {
        return R.ok(overviewService.overview(getTenantId(), null, "all"));
    }

    /** 跨项目成员负载（所有有指派的任务，可选按成员过滤），复用既有 workload。 */
    @GetMapping("/workload")
    public R<List<PmWorkloadItemVO>> workload(@RequestParam(required = false) String memberId) {
        return R.ok(workloadService.workload(getTenantId(), memberId));
    }

    /**
     * バグ一覧（製品内）。pm-web の品質管理タブと同じフィルタ（status/severity/priority/assigneeId/keyword）。
     * 起票前の重複確認や、起票結果の確認に使う。
     */
    @GetMapping("/bugs")
    public R<List<PmBugVO>> listBugs(@RequestParam UUID customerId,
                                    @RequestParam(required = false) String status,
                                    @RequestParam(required = false) String severity,
                                    @RequestParam(required = false) String priority,
                                    @RequestParam(required = false) UUID assigneeId,
                                    @RequestParam(required = false) String keyword) {
        return R.ok(bugService.listByCustomer(getTenantId(), customerId, status, severity, priority,
            assigneeId, keyword));
    }

    /**
     * バグ起票（単独起票）。pm-web の「バグ起票」ドロワーと同じ入力を受け取り、既存の
     * {@link PmBugService#create} を通す（bug_no 採番・製品/プロジェクト/タスク紐付け検証は共通）。
     *
     * <p>{@code reporter_user_id} は NOT NULL。内部 API には Sa-Token のログインユーザーが居ないため、
     * 起票者は {@code X-User-Id} ヘッダ（pm-mcp が MCP トークンから解決したユーザー）で受け取る。</p>
     */
    @PostMapping("/bugs")
    public R<PmBugVO> createBug(@RequestHeader(value = "X-User-Id", required = false) String userIdHeader,
                               @RequestBody @Valid CreateBugReq req) {
        UUID userId = parseUserId(userIdHeader);
        BugInput in = new BugInput(req.title(), req.description(), req.severity(), req.priority(),
            req.status(), req.environment(), null, req.assigneeMemberId(), req.projectId(), req.taskId(),
            null, req.reportedOn(), null);
        return R.ok(bugService.create(getTenantId(), req.customerId(), userId, in));
    }

    /** 起票者ユーザー。未指定/不正なら 400（reporter_user_id は NOT NULL のため補完できない）。 */
    private UUID parseUserId(String raw) {
        if (raw == null || raw.isBlank()) {
            throw BizException.of(400, "起票者が特定できません（X-User-Id 欠落）");
        }
        try {
            return UUID.fromString(raw.trim());
        } catch (IllegalArgumentException e) {
            throw BizException.of(400, "非法的 X-User-Id");
        }
    }

    /** 单发任务创建。复用 CreateTaskReq 字段，走既有 service.create。 */
    @PostMapping("/tasks")
    public R<PmTask> createTask(@RequestBody @Valid PmTaskController.CreateTaskReq req) {
        PmTask task = taskService.create(
            getTenantId(), req.projectId(), req.parentId(), req.name(), req.start(), req.end(),
            req.actualStart(), req.actualEnd(), req.plannedEffortHours(), req.actualEffortHours(),
            req.plannedEffortDays(), req.actualEffortDays(),
            req.progress(), req.assigneeIds(), req.levels(),
            req.description(), req.type(), req.collapsed(), req.order(),
            req.roadmapVisible(), req.roadmapLane(), req.ownerParty(), req.milestoneColor(), req.status());
        return R.ok(task);
    }

    /**
     * 单发任务更新（部分更新，null=不变）。复用 UpdateTaskReq 字段与既有 service.update，
     * rollup / progress / cascade / 跨项目移动等均走原有逻辑。仅传 name 即可安全改名。
     */
    @PutMapping("/tasks/{id}")
    public R<PmTask> updateTask(@PathVariable UUID id,
                               @RequestBody @Valid PmTaskController.UpdateTaskReq req) {
        PmTask task = taskService.update(
            id, getTenantId(), req.projectId(), req.name(), req.start(), req.end(),
            req.actualStart(), req.actualEnd(),
            req.plannedEffortHours(), req.actualEffortHours(),
            req.plannedEffortDays(), req.actualEffortDays(),
            req.progress(), req.assigneeIds(), req.levels(),
            req.description(), req.type(),
            req.collapsed(), req.order(), req.parentId(), req.reparent(),
            req.clearActual(), req.clearActualEnd(), req.clearEffort(),
            req.roadmapVisible(), req.roadmapLane(), req.ownerParty(), req.milestoneColor(), req.status());
        return R.ok(task);
    }

    /**
     * 一括ツリー作成。对 nodes 做拓扑排序（父在前）后逐个创建：
     * parentTempId==null 的节点接到顶层 parentId，否则接到该 tempId 已创建出的真实 UUID。
     * 整个方法在一个事务内执行，返回 idMap（tempId → 真实 UUID）。
     */
    @PostMapping("/tasks/tree")
    @Transactional
    public R<Map<String, UUID>> createTaskTree(@RequestBody @Valid CreateTaskTreeReq req) {
        UUID tenantId = getTenantId();
        List<TreeNode> ordered = topoSort(req.nodes());

        Map<String, UUID> idMap = new LinkedHashMap<>();
        for (TreeNode node : ordered) {
            UUID parentId;
            if (node.parentTempId() == null || node.parentTempId().isBlank()) {
                parentId = req.parentId();
            } else {
                parentId = idMap.get(node.parentTempId());
                if (parentId == null) {
                    // 拓扑排序保证父先创建；走到这里说明 parentTempId 引用了不存在的节点
                    throw BizException.of(400, "节点 " + node.tempId() + " 的 parentTempId 无效：" + node.parentTempId());
                }
            }
            PmTask task = taskService.create(
                tenantId, req.projectId(), parentId, node.name(), node.start(), node.end(),
                node.actualStart(), node.actualEnd(), node.plannedEffortHours(), node.actualEffortHours(),
                node.plannedEffortDays(), node.actualEffortDays(),
                node.progress(), node.assigneeIds(), node.levels(),
                node.description(), node.type(), node.collapsed(), node.order(),
                node.roadmapVisible(), node.roadmapLane(), node.ownerParty(), node.milestoneColor(), node.status());
            idMap.put(node.tempId(), task.getId());
        }
        return R.ok(idMap);
    }

    /** 按 parentTempId 关系做拓扑排序（父在子之前）。校验 tempId 唯一、无环、引用存在。 */
    private List<TreeNode> topoSort(List<TreeNode> nodes) {
        if (nodes == null || nodes.isEmpty()) {
            return List.of();
        }
        Map<String, TreeNode> byTemp = new LinkedHashMap<>();
        for (TreeNode n : nodes) {
            if (n.tempId() == null || n.tempId().isBlank()) {
                throw BizException.of(400, "存在缺少 tempId 的节点");
            }
            if (byTemp.put(n.tempId(), n) != null) {
                throw BizException.of(400, "tempId 重复：" + n.tempId());
            }
        }
        // 引用校验：parentTempId 非空时必须指向已知节点
        for (TreeNode n : nodes) {
            String pt = n.parentTempId();
            if (pt != null && !pt.isBlank() && !byTemp.containsKey(pt)) {
                throw BizException.of(400, "节点 " + n.tempId() + " 的 parentTempId 不存在：" + pt);
            }
        }

        List<TreeNode> ordered = new ArrayList<>();
        Set<String> done = new HashSet<>();
        Set<String> visiting = new HashSet<>();
        for (TreeNode n : nodes) {
            visit(n, byTemp, done, visiting, ordered);
        }
        return ordered;
    }

    private void visit(TreeNode n, Map<String, TreeNode> byTemp, Set<String> done,
                       Set<String> visiting, List<TreeNode> ordered) {
        if (done.contains(n.tempId())) {
            return;
        }
        if (!visiting.add(n.tempId())) {
            throw BizException.of(400, "节点存在循环引用：" + n.tempId());
        }
        String pt = n.parentTempId();
        if (pt != null && !pt.isBlank()) {
            visit(byTemp.get(pt), byTemp, done, visiting, ordered);
        }
        visiting.remove(n.tempId());
        done.add(n.tempId());
        ordered.add(n);
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失");
        }
        return tenantId;
    }

    /** MCP 令牌反查结果 */
    public record McpResolveResult(
        String tenantId,
        String userId
    ) {
    }

    /** 项目检索结果项 */
    public record ProjectItem(
        UUID id,
        String name,
        UUID customerId,
        String customerName,
        /** 親プロジェクト（サブプロジェクトのみ）；null=トップレベル */
        UUID parentId
    ) {
    }

    /** 顧客/製品検索結果項 */
    public record CustomerItem(
        UUID id,
        String name,
        String shortName,
        Boolean active
    ) {
    }

    /** 成员検索結果項 */
    public record MemberItem(
        UUID id,
        String name,
        String role
    ) {
    }

    /** バグ起票リクエスト（pm-web のバグ起票ドロワーと同じ入力） */
    public record CreateBugReq(
        /** 起票先の製品（pm_customer.id）。バグ番号 BUG-xxx はこの製品内で採番される */
        @NotNull UUID customerId,
        @NotBlank String title,
        /** 内容（再現手順/期待/実際）。リッチテキスト HTML 可 */
        String description,
        /** 影響度 high/medium/low（既定 medium） */
        String severity,
        /** 優先度 high/medium/low（既定 medium） */
        String priority,
        /** 状態 open/in_progress/resolved/verifying/closed/wontfix（既定 open） */
        String status,
        /** 環境メモ（例 Chrome / dev） */
        String environment,
        /** 担当メンバー（pm_member.id；null=未割当） */
        UUID assigneeMemberId,
        /** 紐付けプロジェクト/版本（null=製品全体）。製品配下のもののみ許可 */
        UUID projectId,
        /** 紐付けタスク（pm_task.id；null=紐付けなし） */
        UUID taskId,
        /** 起票日（null=当日） */
        LocalDate reportedOn
    ) {
    }

    /** 一括ツリー作成请求体 */
    public record CreateTaskTreeReq(
        @NotNull UUID projectId,
        /** 整棵树接到的既有任务（既存タスク配下に挿す时使用；顶层节点用之；null=根级） */
        UUID parentId,
        @NotNull List<TreeNode> nodes
    ) {
    }

    /** 树节点。字段尽量覆盖 CreateTaskReq 的可选字段，未提供由 service 给合理默认。 */
    public record TreeNode(
        @NotBlank String tempId,
        /** null/空=接到顶层 parentId；否则指向同批次另一节点的 tempId */
        String parentTempId,
        @NotBlank String name,
        @NotNull LocalDate start,
        @NotNull LocalDate end,
        LocalDate actualStart,
        LocalDate actualEnd,
        /** 予定工期·最終日の作業時間（手填小时 0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天） */
        Double plannedEffortHours,
        /** 実績工期·最終日の作業時間（手填小时 0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天） */
        Double actualEffortHours,
        /** 予定工期·日数（手动，1d=24h；null=回退期间派生） */
        Integer plannedEffortDays,
        /** 実績工期·日数（手动，1d=24h；null=回退期间派生） */
        Integer actualEffortDays,
        Integer progress,
        List<String> assigneeIds,
        List<String> levels,
        String description,
        /** summary / task / milestone（默认 task，由 service 兜底） */
        String type,
        Boolean collapsed,
        Integer order,
        Boolean roadmapVisible,
        String roadmapLane,
        /** client（贵社）/ vendor（弊社） */
        String ownerParty,
        String milestoneColor,
        String status
    ) {
    }
}

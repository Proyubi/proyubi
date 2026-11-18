package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmBugService;
import ai.proyubi.pm.service.PmBugService.BugInput;
import ai.proyubi.pm.vo.PmBugVO;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 品質管理 Controller：バグ票。ルートは {@code /app/pm/**}。
 * 失敗ケースからの起票（{@code /test-cases/{id}/bugs}）／単独起票／タスク別一覧に対応。
 *
 */
@RestController
@RequestMapping("/app/pm")
public class PmBugController {

    private final PmBugService bugService;

    public PmBugController(PmBugService bugService) {
        this.bugService = bugService;
    }

    @GetMapping("/customers/{customerId}/bugs")
    public R<List<PmBugVO>> listByCustomer(@PathVariable UUID customerId,
                                          @RequestParam(required = false) String status,
                                          @RequestParam(required = false) String severity,
                                          @RequestParam(required = false) String priority,
                                          @RequestParam(required = false) UUID assigneeId,
                                          @RequestParam(required = false) String keyword) {
        return R.ok(bugService.listByCustomer(getTenantId(), customerId, status, severity, priority, assigneeId, keyword));
    }

    @PostMapping("/customers/{customerId}/bugs")
    public R<PmBugVO> create(@PathVariable UUID customerId, @RequestBody BugInput in) {
        return R.ok(bugService.create(getTenantId(), customerId, TenantContext.getUserId(), in));
    }

    @PostMapping("/test-cases/{id}/bugs")
    public R<PmBugVO> createFromCase(@PathVariable UUID id, @RequestBody BugInput in) {
        return R.ok(bugService.createFromCase(getTenantId(), id, TenantContext.getUserId(), in));
    }

    @GetMapping("/bugs/{id}")
    public R<PmBugVO> get(@PathVariable UUID id) {
        return R.ok(bugService.getVO(id, getTenantId()));
    }

    @PatchMapping("/bugs/{id}")
    public R<PmBugVO> update(@PathVariable UUID id, @RequestBody UpdateBugReq req) {
        BugInput in = new BugInput(req.title(), req.description(), req.severity(), req.priority(),
            null, req.environment(), req.environmentId(), req.assigneeMemberId(), req.projectId(), req.taskId(),
            req.customerId(), req.reportedOn(), req.resolvedAt());
        return R.ok(bugService.update(id, getTenantId(), in,
            req.unlinkTask() != null && req.unlinkTask(),
            req.unlinkProject() != null && req.unlinkProject(),
            req.clearAssignee() != null && req.clearAssignee(),
            req.clearResolvedAt() != null && req.clearResolvedAt(),
            req.unlinkEnvironment() != null && req.unlinkEnvironment()));
    }

    /** バグ→タスクの一括紐付け／解除。ids のバグをまとめて taskId に紐付ける（unlinkTask=true で一括解除）。
     *  バグ一覧側（複数バグ→1タスク）とタスク側（1タスク→複数バグ）の双方から呼ぶ。返り値=更新件数。 */
    @PatchMapping("/bugs/batch-task")
    public R<Integer> batchTask(@RequestBody BatchTaskReq req) {
        return R.ok(bugService.batchLinkTask(getTenantId(), req.ids(), req.taskId(),
            req.unlinkTask() != null && req.unlinkTask()));
    }

    @PatchMapping("/bugs/{id}/status")
    public R<PmBugVO> updateStatus(@PathVariable UUID id, @RequestBody StatusReq req) {
        return R.ok(bugService.updateStatus(id, getTenantId(), req.status()));
    }

    @DeleteMapping("/bugs/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        bugService.delete(id, getTenantId());
        return R.ok();
    }

    @GetMapping("/tasks/{taskId}/bugs")
    public R<List<PmBugVO>> listByTask(@PathVariable UUID taskId) {
        return R.ok(bugService.listByTask(getTenantId(), taskId));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    public record UpdateBugReq(
        String title, String description, String severity, String priority, String environment,
        UUID environmentId, UUID assigneeMemberId, UUID projectId, UUID taskId, UUID customerId,
        java.time.LocalDate reportedOn, java.time.LocalDateTime resolvedAt,
        Boolean unlinkProject, Boolean unlinkTask, Boolean clearAssignee, Boolean clearResolvedAt,
        Boolean unlinkEnvironment
    ) {}

    public record StatusReq(String status) {}

    public record BatchTaskReq(List<UUID> ids, UUID taskId, Boolean unlinkTask) {}
}

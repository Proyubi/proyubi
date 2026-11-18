package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.service.PmTaskActivityService;
import ai.proyubi.pm.service.PmTaskService;
import ai.proyubi.pm.vo.PmTaskActivityVO;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 任务Controller（PM / WBS 树）
 *
 */
@RestController
@RequestMapping("/app/pm")
@Validated
public class PmTaskController {

    private final PmTaskService taskService;
    private final PmTaskActivityService activityService;

    public PmTaskController(PmTaskService taskService, PmTaskActivityService activityService) {
        this.taskService = taskService;
        this.activityService = activityService;
    }

    /** 项目任务列表（summary 已汇总） */
    @GetMapping("/projects/{projectId}/tasks")
    public R<List<PmTask>> listByProject(@PathVariable UUID projectId) {
        return R.ok(taskService.listByProject(getTenantId(), projectId));
    }

    /** 项目内全部 summary 任务统一展开/折叠 */
    @PutMapping("/projects/{projectId}/tasks/collapse-all")
    public R<Void> setCollapsedAll(@PathVariable UUID projectId, @RequestParam boolean collapsed) {
        taskService.setCollapsedAll(getTenantId(), projectId, collapsed);
        return R.ok();
    }

    @PostMapping("/tasks")
    public R<PmTask> create(@RequestBody @Valid CreateTaskReq req) {
        PmTask task = taskService.create(
            getTenantId(), req.projectId(), req.parentId(), req.name(), req.start(), req.end(),
            req.actualStart(), req.actualEnd(), req.plannedEffortHours(), req.actualEffortHours(),
            req.plannedEffortDays(), req.actualEffortDays(),
            req.progress(), req.assigneeIds(), req.levels(),
            req.description(), req.type(), req.collapsed(), req.order(),
            req.roadmapVisible(), req.roadmapLane(), req.ownerParty(), req.milestoneColor(), req.status());
        return R.ok(task);
    }

    @PutMapping("/tasks/{id}")
    public R<PmTask> update(@PathVariable UUID id, @RequestBody @Valid UpdateTaskReq req) {
        PmTask task = taskService.update(
            id, getTenantId(), req.projectId(), req.name(), req.start(), req.end(), req.actualStart(), req.actualEnd(),
            req.plannedEffortHours(), req.actualEffortHours(), req.plannedEffortDays(), req.actualEffortDays(),
            req.progress(), req.assigneeIds(), req.levels(),
            req.description(), req.type(),
            req.collapsed(), req.order(), req.parentId(), req.reparent(), req.clearActual(), req.clearActualEnd(),
            req.clearEffort(),
            req.roadmapVisible(), req.roadmapLane(), req.ownerParty(), req.milestoneColor(), req.status());
        return R.ok(task);
    }

    @DeleteMapping("/tasks/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        taskService.delete(id, getTenantId());
        return R.ok();
    }

    /**
     * タスク操作履歴（新しい順）。ドロワー右カラムの「操作履歴」タブが読む。
     * 先にタスクの可視性を検証してから履歴を返す（同租户・跨チームの横取り防止）。
     */
    @GetMapping("/tasks/{id}/activities")
    public R<List<PmTaskActivityVO>> activities(@PathVariable UUID id,
                                                @RequestParam(required = false) Integer limit) {
        UUID tenantId = getTenantId();
        taskService.getVisibleTask(id, tenantId);
        return R.ok(activityService.list(tenantId, id, limit));
    }

    /** 切换某 summary 任务的折叠状态 */
    @PutMapping("/tasks/{id}/collapse")
    public R<PmTask> toggleCollapse(@PathVariable UUID id) {
        return R.ok(taskService.toggleCollapse(id, getTenantId()));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    public record CreateTaskReq(
        @NotNull UUID projectId,
        UUID parentId,
        @NotBlank String name,
        @NotNull LocalDate start,
        @NotNull LocalDate end,
        LocalDate actualStart,
        LocalDate actualEnd,
        /** 予定工期·最終日の作業時間（手填小时 0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天） */
        @DecimalMin("0") @DecimalMax(value = "24", inclusive = false) Double plannedEffortHours,
        /** 実績工期·最終日の作業時間（手填小时 0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天） */
        @DecimalMin("0") @DecimalMax(value = "24", inclusive = false) Double actualEffortHours,
        /** 予定工期·日数（手动，1d=24h；null=回退期间派生） */
        @Min(0) @Max(3650) Integer plannedEffortDays,
        /** 実績工期·日数（手动，1d=24h；null=回退期间派生） */
        @Min(0) @Max(3650) Integer actualEffortDays,
        @Min(0) @Max(100) Integer progress,
        List<String> assigneeIds,
        List<String> levels,
        String description,
        String type,
        Boolean collapsed,
        Integer order,
        Boolean roadmapVisible,
        String roadmapLane,
        String ownerParty,
        String milestoneColor,
        String status
    ) {
    }

    public record UpdateTaskReq(
        /** 目标项目（与当前不同则整棵子树跨项目移动；null=不变） */
        UUID projectId,
        String name,
        LocalDate start,
        LocalDate end,
        LocalDate actualStart,
        LocalDate actualEnd,
        /** 予定工期·最終日の作業時間（手填小时 0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天） */
        @DecimalMin("0") @DecimalMax(value = "24", inclusive = false) Double plannedEffortHours,
        /** 実績工期·最終日の作業時間（手填小时 0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天） */
        @DecimalMin("0") @DecimalMax(value = "24", inclusive = false) Double actualEffortHours,
        /** 予定工期·日数（手动，1d=24h；null=不变，清回 null 走 clearEffort） */
        @Min(0) @Max(3650) Integer plannedEffortDays,
        /** 実績工期·日数（手动，1d=24h；null=不变，清回 null 走 clearEffort） */
        @Min(0) @Max(3650) Integer actualEffortDays,
        @Min(0) @Max(100) Integer progress,
        List<String> assigneeIds,
        List<String> levels,
        String description,
        String type,
        Boolean collapsed,
        Integer order,
        UUID parentId,
        /** true=parentId 为权威值（含 null=移到根级）；null/false 时沿用 null=不变 的旧约定 */
        Boolean reparent,
        /** true=显式清空实际起止时间（两端；null 表示不变） */
        Boolean clearActual,
        /** true=仅清空实际结束日、保留开始日（着手中/进行中；与 clearActual 排他；null 表示不变） */
        Boolean clearActualEnd,
        /** true=显式把予定/実績手动工期日数清回 null（回退期间派生）；null 表示不变 */
        Boolean clearEffort,
        Boolean roadmapVisible,
        String roadmapLane,
        String ownerParty,
        String milestoneColor,
        String status
    ) {
    }
}

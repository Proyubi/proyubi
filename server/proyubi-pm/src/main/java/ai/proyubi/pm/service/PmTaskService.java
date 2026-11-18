package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmDependency;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmRoadmapOption;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmDependencyMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import ai.proyubi.pm.vo.PmRoadmapVO;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.update.UpdateChain;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 任务Service（PM）。负责 WBS 树的增删改、折叠、汇总，以及任务变化后回写项目整体进度。
 *
 */
@Service
public class PmTaskService {

    private final PmTaskMapper taskMapper;
    private final PmDependencyMapper dependencyMapper;
    private final PmProjectMapper projectMapper;
    private final TaskRollupService rollupService;
    private final PmRoadmapOptionService roadmapOptionService;
    private final PmHolidayService holidayService;
    private final PmTeamScopeService teamScope;
    private final PmCascadeService cascadeService;
    private final PmSettingService settingService;
    private final PmTaskActivityService activityService;
    private final PmProjectProgressService progressService;

    public PmTaskService(PmTaskMapper taskMapper, PmDependencyMapper dependencyMapper,
                         PmProjectMapper projectMapper, TaskRollupService rollupService,
                         PmRoadmapOptionService roadmapOptionService,
                         PmHolidayService holidayService, PmTeamScopeService teamScope,
                         PmCascadeService cascadeService, PmSettingService settingService,
                         PmTaskActivityService activityService, PmProjectProgressService progressService) {
        this.progressService = progressService;
        this.taskMapper = taskMapper;
        this.dependencyMapper = dependencyMapper;
        this.projectMapper = projectMapper;
        this.rollupService = rollupService;
        this.roadmapOptionService = roadmapOptionService;
        this.holidayService = holidayService;
        this.teamScope = teamScope;
        this.cascadeService = cascadeService;
        this.settingService = settingService;
        this.activityService = activityService;
    }

    /** 校验某任务所属项目的团队对当前用户可见（owner / 纯机械上下文恒可见；MCP は X-User-Id 基準で絞られる）。 */
    private void assertTaskVisible(PmTask task) {
        if (task == null || task.getProjectId() == null) {
            return;
        }
        PmProject project = projectMapper.selectOneById(task.getProjectId());
        if (project != null) {
            teamScope.assertTeamVisible(project.getTeamId());
        }
    }

    /** 原始任务列表（未汇总），供内部计算使用 */
    public List<PmTask> rawList(UUID tenantId, UUID projectId) {
        return taskMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTask::getTenantId).eq(tenantId)
                .and(PmTask::getProjectId).eq(projectId)
                .and(PmTask::getDeletedAt).isNull()
                .orderBy(PmTask::getOrder, true)
        );
    }

    /** 项目任务列表（summary 已汇总），供前端甘特图渲染 */
    public List<PmTask> listByProject(UUID tenantId, UUID projectId) {
        PmProject project = requireProject(projectId, tenantId);   // 校验项目存在 + 团队可见
        Set<LocalDate> holidays = holidayService.getHolidayDates(tenantId);
        double hoursPerDay = settingService.getHoursPerWorkday(tenantId);
        List<PmTask> tasks = rollupService.rollup(rawList(tenantId, projectId), holidays, hoursPerDay);
        // 自愈：列表页直接读缓存字段 pm_project.progress（不按项目加载任务）。若该缓存与实时汇总漂移
        // ——例如改了假日日历、或历史上经某条绕过 recomputeProjectProgress 的路径完成了任务——
        // 列表页会长期显示陈旧进度。这里在打开甘特（已加载全树）时顺带订正：仅在不一致时回写，
        // 且不触碰 updated_at（这是订正而非用户编辑）。
        // サブを持つ親は「サブ＋親直下タスク」の加重集計が正（自分のタスクだけで上書きしない）。
        int live = progressService.liveProgressWithOwnTasks(tenantId, project, tasks, holidays, hoursPerDay);
        int cached = project.getProgress() != null ? project.getProgress() : 0;
        if (live != cached) {
            UpdateChain.of(PmProject.class)
                .set(PmProject::getProgress, live)
                .where(PmProject::getId).eq(projectId)
                .update();
            // サブの値が直ったなら親の集計も追従させる
            progressService.recomputeParent(tenantId, project.getParentId());
        }
        return tasks;
    }

    /** 路线图：项目内 roadmapVisible=true 的（已汇总）条目 + 项目起止 */
    public PmRoadmapVO roadmap(UUID tenantId, UUID projectId) {
        PmProject project = projectMapper.selectOneById(projectId);
        if (project == null || !project.getTenantId().equals(tenantId) || project.getDeletedAt() != null) {
            throw BizException.of(404, "项目不存在");
        }
        teamScope.assertTeamVisible(project.getTeamId());
        List<PmTask> tasks = rollupService.rollup(rawList(tenantId, projectId),
            holidayService.getHolidayDates(tenantId), settingService.getHoursPerWorkday(tenantId));
        List<PmRoadmapVO.RoadmapItem> items = new ArrayList<>();
        for (PmTask t : tasks) {
            if (!Boolean.TRUE.equals(t.getRoadmapVisible())) {
                continue;
            }
            items.add(new PmRoadmapVO.RoadmapItem(
                t.getId().toString(),
                t.getName(),
                t.getType(),
                t.getStart() != null ? t.getStart().toString() : null,
                t.getEnd() != null ? t.getEnd().toString() : null,
                t.getProgress() != null ? t.getProgress() : 0,
                t.getRoadmapLane(),
                t.getOwnerParty(),
                t.getMilestoneColor()
            ));
        }
        String start = project.getStart() != null ? project.getStart().toString() : null;
        String end = project.getEnd() != null ? project.getEnd().toString() : null;
        return new PmRoadmapVO(projectId.toString(), start, end, items, buildRoadmapOptions(tenantId));
    }

    /** 把租户字典装配成路线图渲染用的 options（按 kind 分组，已按 sort_order 排序）。 */
    private PmRoadmapVO.RoadmapOptions buildRoadmapOptions(UUID tenantId) {
        List<PmRoadmapVO.OptionDef> lanes = new ArrayList<>();
        List<PmRoadmapVO.OptionDef> msColors = new ArrayList<>();
        for (PmRoadmapOption o : roadmapOptionService.loadForRoadmap(tenantId)) {
            PmRoadmapVO.OptionDef def = new PmRoadmapVO.OptionDef(
                o.getOptionKey(),
                o.getLabel(),
                o.getColor(),
                o.getSortOrder() != null ? o.getSortOrder() : 0
            );
            if ("ms_color".equals(o.getKind())) {
                msColors.add(def);
            } else if ("lane".equals(o.getKind())) {
                lanes.add(def);
            }
        }
        return new PmRoadmapVO.RoadmapOptions(lanes, msColors);
    }

    public PmTask getByIdAndTenant(UUID id, UUID tenantId) {
        PmTask task = taskMapper.selectOneById(id);
        if (task == null || !task.getTenantId().equals(tenantId) || task.getDeletedAt() != null) {
            throw BizException.of(404, "任务不存在");
        }
        return task;
    }

    /**
     * 取任务并校验其所属项目的团队对当前用户可见。
     * 评论 / 链接 / 依赖等任务的从属资源应统一经此入口取任务，避免只校租户、
     * 漏掉团队可见性导致的同租户跨团队横向越权。owner / 纯机械上下文（user なし）恒可见。
     */
    public PmTask getVisibleTask(UUID id, UUID tenantId) {
        PmTask task = getByIdAndTenant(id, tenantId);
        assertTaskVisible(task);
        return task;
    }

    @Transactional
    public PmTask create(UUID tenantId, UUID projectId, UUID parentId, String name,
                         LocalDate start, LocalDate end, LocalDate actualStart, LocalDate actualEnd,
                         Double plannedEffortHours, Double actualEffortHours,
                         Integer plannedEffortDays, Integer actualEffortDays,
                         Integer progress, List<String> assigneeIds, List<String> levels,
                         String description, String type, Boolean collapsed, Integer order,
                         Boolean roadmapVisible, String roadmapLane, String ownerParty,
                         String milestoneColor, String status) {
        PmProject project = requireProject(projectId, tenantId);
        validateWithinProject(project, start, end);
        if (parentId != null) {
            getByIdAndTenant(parentId, tenantId); // 父任务必须属于本租户
        }
        PmTask task = new PmTask();
        task.setId(UUID.randomUUID());
        task.setTenantId(tenantId);
        task.setProjectId(projectId);
        task.setParentId(parentId);
        task.setName(name);
        task.setStart(start);
        task.setEnd(end);
        task.setActualStart(actualStart);
        task.setActualEnd(actualEnd);
        task.setPlannedEffortHours(plannedEffortHours);
        task.setActualEffortHours(actualEffortHours);
        // 手动工期日数：直接落库（含 null=该套回退期间派生）
        task.setPlannedEffortDays(plannedEffortDays);
        task.setActualEffortDays(actualEffortDays);
        task.setProgress(clampProgress(progress != null ? progress : 0));
        task.setAssigneeIds(assigneeIds != null ? assigneeIds : List.of());
        task.setLevels(levels != null ? levels : List.of());
        task.setDescription(description);
        task.setType(type != null ? type : "task");
        task.setCollapsed(collapsed != null ? collapsed : false);
        task.setOrder(order != null ? order : 0);
        task.setRoadmapVisible(roadmapVisible != null ? roadmapVisible : false);
        task.setRoadmapLane(roadmapLane);
        task.setOwnerParty(ownerParty);
        task.setMilestoneColor(milestoneColor);
        task.setStatus(status != null ? status : "todo");
        task.setCreatedAt(LocalDateTime.now());
        task.setUpdatedAt(LocalDateTime.now());
        taskMapper.insert(task);
        activityService.recordCreated(tenantId, task);
        // サブタスク追加は親タスク側の履歴にも残す（親のドロワーで「何が増えたか」が読める）
        activityService.recordChild(tenantId, parentId, projectId, task.getName(), true);
        recomputeProjectProgress(tenantId, projectId);
        return task;
    }

    @Transactional
    public PmTask update(UUID id, UUID tenantId, UUID newProjectId, String name, LocalDate start, LocalDate end,
                         LocalDate actualStart, LocalDate actualEnd,
                         Double plannedEffortHours, Double actualEffortHours,
                         Integer plannedEffortDays, Integer actualEffortDays, Integer progress,
                         List<String> assigneeIds, List<String> levels, String description,
                         String type, Boolean collapsed, Integer order, UUID parentId,
                         Boolean reparent, Boolean clearActual, Boolean clearActualEnd, Boolean clearEffort,
                         Boolean roadmapVisible,
                         String roadmapLane, String ownerParty, String milestoneColor, String status) {
        PmTask task = getByIdAndTenant(id, tenantId);
        assertTaskVisible(task);   // 团队可见性校验
        // 差分（操作履歴）用に更新前の値を写し取る。以降 task は破壊的に書き換わる
        PmTask before = PmTaskActivityService.snapshot(task);
        UUID oldProjectId = task.getProjectId();
        // reparent=true 时 parentId 为权威值（含 null=移到根级）；否则沿用 null=不变 的旧约定
        boolean applyParent = Boolean.TRUE.equals(reparent);
        // 跨项目移动：整棵子树（任务 + 全部子孙）迁到目标项目
        boolean crossProject = newProjectId != null && !newProjectId.equals(oldProjectId);
        Integer movedOrder = null;
        if (crossProject) {
            requireProject(newProjectId, tenantId);
            // 跨项目时 parentId 一律按字面处理（null=根级）
            movedOrder = moveSubtreeToProject(task, tenantId, oldProjectId, newProjectId, parentId);
            ensureParentIsSummary(parentId, tenantId);
            task.setProjectId(newProjectId);
            task.setParentId(parentId);
        } else if (applyParent) {
            // 同项目内改父级：环路守卫
            guardReparent(task, parentId, tenantId, oldProjectId);
            ensureParentIsSummary(parentId, tenantId);
            task.setParentId(parentId);
        }

        if (name != null) task.setName(name);
        if (start != null) task.setStart(start);
        if (end != null) task.setEnd(end);
        // 计划起止变更（含跨项目移动）后，按合并后的现值校验是否落在（目标）项目周期内
        if (start != null || end != null || crossProject) {
            PmProject project = requireProject(task.getProjectId(), tenantId);
            validateWithinProject(project, task.getStart(), task.getEnd());
        }
        if (actualStart != null) task.setActualStart(actualStart);
        if (actualEnd != null) task.setActualEnd(actualEnd);
        // 工期·最終日の作業時間（予定/実績）：null=不変（部分更新と衝突回避）、0 含む数値はそのまま反映
        if (plannedEffortHours != null) task.setPlannedEffortHours(plannedEffortHours);
        if (actualEffortHours != null) task.setActualEffortHours(actualEffortHours);
        // 手动工期日数（予定/実績）：null=不変（同上）；0 含む数値は手动設定として反映。
        // 「清空回自动（NULL へ戻す）」は null では表現できないため clearEffort 旗で別途処理（下方）。
        if (plannedEffortDays != null) task.setPlannedEffortDays(plannedEffortDays);
        if (actualEffortDays != null) task.setActualEffortDays(actualEffortDays);
        if (progress != null) task.setProgress(clampProgress(progress));
        if (assigneeIds != null) task.setAssigneeIds(assigneeIds);
        if (levels != null) task.setLevels(levels);
        if (description != null) task.setDescription(description);
        if (type != null) task.setType(type);
        if (collapsed != null) task.setCollapsed(collapsed);
        if (movedOrder != null) task.setOrder(movedOrder);
        else if (order != null) task.setOrder(order);
        // parentId 已在上面处理（reparent / 跨项目）；非 reparent 时保留旧约定
        if (!applyParent && !crossProject && parentId != null) task.setParentId(parentId);
        if (roadmapVisible != null) task.setRoadmapVisible(roadmapVisible);
        if (roadmapLane != null) task.setRoadmapLane(roadmapLane);
        if (ownerParty != null) task.setOwnerParty(ownerParty);
        if (milestoneColor != null) task.setMilestoneColor(milestoneColor);
        if (status != null) task.setStatus(status);
        task.setUpdatedAt(LocalDateTime.now());
        // 跨项目移动会把 parentId 改成 null（移到根级），普通 update 忽略 null 无法写入，需显式置空
        if (crossProject && parentId == null) {
            UpdateChain.of(PmTask.class)
                .set(PmTask::getProjectId, newProjectId)
                .set(PmTask::getParentId, null)
                .where(PmTask::getId).eq(id)
                .update();
        }
        // 同项目内移到根级（reparent + null）同样需显式置空
        if (!crossProject && applyParent && parentId == null) {
            UpdateChain.of(PmTask.class)
                .set(PmTask::getParentId, null)
                .where(PmTask::getId).eq(id)
                .update();
        }
        taskMapper.update(task);
        // 显式清空实际起止时间（null 无法通过默认忽略 null 的 update 写入）
        if (Boolean.TRUE.equals(clearActual)) {
            UpdateChain.of(PmTask.class)
                .set(PmTask::getActualStart, null)
                .set(PmTask::getActualEnd, null)
                .where(PmTask::getId).eq(id)
                .update();
            task.setActualStart(null);
            task.setActualEnd(null);
        }
        // 実績「着手中」：開始日あり・終了日なし（ongoing）→ 終了だけを明示 NULL へ戻す。
        // clearActual（両端クリア）と排他。null は既定の update で書けないため UpdateChain。
        if (Boolean.TRUE.equals(clearActualEnd) && !Boolean.TRUE.equals(clearActual)) {
            UpdateChain.of(PmTask.class)
                .set(PmTask::getActualEnd, null)
                .where(PmTask::getId).eq(id)
                .update();
            task.setActualEnd(null);
        }
        // 显式把手动工期日数清回 null（回退期间派生）。两框皆空＝自動へ戻す，前端送 clearEffort=true。
        // 与 clearActual 同理：null 无法经默认忽略 null 的 update 写入，需 UpdateChain 显式置空。
        if (Boolean.TRUE.equals(clearEffort)) {
            UpdateChain.of(PmTask.class)
                .set(PmTask::getPlannedEffortDays, null)
                .set(PmTask::getActualEffortDays, null)
                .where(PmTask::getId).eq(id)
                .update();
            task.setPlannedEffortDays(null);
            task.setActualEffortDays(null);
        }
        // 明示クリア（実績・工期）まで反映し終えた最終状態で差分を取る
        activityService.recordUpdated(tenantId, before, task);
        recomputeProjectProgress(tenantId, task.getProjectId());
        if (crossProject) {
            recomputeProjectProgress(tenantId, oldProjectId);
        }
        return task;
    }

    /**
     * 把 root 及其全部子孙从 oldPid 迁到 newPid。
     * 仅迁移子孙（root 的 projectId/parentId/order 由调用方在主 update 里统一写）。
     * 子树内部依赖跟随迁移，跨越子树边界的依赖软删除。
     *
     * @return root 在目标项目新父级下应排到的 order（末尾）
     */
    private Integer moveSubtreeToProject(PmTask root, UUID tenantId, UUID oldPid, UUID newPid, UUID newParentId) {
        if (newParentId != null) {
            PmTask np = getByIdAndTenant(newParentId, tenantId);
            if (!newPid.equals(np.getProjectId())) {
                throw BizException.of(400, "父任务不属于目标项目");
            }
        }
        List<PmTask> oldAll = rawList(tenantId, oldPid);
        Set<UUID> sub = collectSubtree(root.getId(), oldAll);

        // 目标项目新父级下的末尾 order
        List<PmTask> newAll = rawList(tenantId, newPid);
        int maxOrder = -1;
        for (PmTask t : newAll) {
            boolean sameParent = newParentId == null
                ? t.getParentId() == null
                : newParentId.equals(t.getParentId());
            if (sameParent && t.getOrder() != null) {
                maxOrder = Math.max(maxOrder, t.getOrder());
            }
        }

        LocalDateTime now = LocalDateTime.now();
        // 迁移子孙（不含 root，root 由主 update 处理）：一条 SQL 批量改项目
        List<UUID> descIds = new ArrayList<>();
        for (UUID sid : sub) {
            if (!sid.equals(root.getId())) {
                descIds.add(sid);
            }
        }
        if (!descIds.isEmpty()) {
            UpdateChain.of(PmTask.class)
                .set(PmTask::getProjectId, newPid)
                .set(PmTask::getUpdatedAt, now)
                .where(PmTask::getTenantId).eq(tenantId)
                .and(PmTask::getId).in(descIds)
                .update();
        }

        // 依赖：子树内部 → 改项目；跨边界 → 软删除。先分类，再各一条 SQL 批量处理
        List<PmDependency> deps = dependencyMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmDependency::getTenantId).eq(tenantId)
                .and(PmDependency::getProjectId).eq(oldPid)
                .and(PmDependency::getDeletedAt).isNull()
        );
        List<UUID> internalDepIds = new ArrayList<>();
        List<UUID> boundaryDepIds = new ArrayList<>();
        for (PmDependency dep : deps) {
            boolean p = sub.contains(dep.getPredecessorId());
            boolean s = sub.contains(dep.getSuccessorId());
            if (p && s) {
                internalDepIds.add(dep.getId());
            } else if (p || s) {
                boundaryDepIds.add(dep.getId());
            }
        }
        if (!internalDepIds.isEmpty()) {
            UpdateChain.of(PmDependency.class)
                .set(PmDependency::getProjectId, newPid)
                .set(PmDependency::getUpdatedAt, now)
                .where(PmDependency::getTenantId).eq(tenantId)
                .and(PmDependency::getId).in(internalDepIds)
                .update();
        }
        if (!boundaryDepIds.isEmpty()) {
            UpdateChain.of(PmDependency.class)
                .set(PmDependency::getDeletedAt, now)
                .set(PmDependency::getUpdatedAt, now)
                .where(PmDependency::getTenantId).eq(tenantId)
                .and(PmDependency::getId).in(boundaryDepIds)
                .update();
        }
        return maxOrder + 1;
    }

    /** 同项目内改父级的合法性校验：父级须存在、属于本项目，且不能是自身或自身子孙（防环） */
    private void guardReparent(PmTask task, UUID newParentId, UUID tenantId, UUID projectId) {
        if (newParentId == null) {
            return; // 移到根级
        }
        if (newParentId.equals(task.getId())) {
            throw BizException.of(400, "不能将任务移动到自身下");
        }
        PmTask np = getByIdAndTenant(newParentId, tenantId);
        if (!projectId.equals(np.getProjectId())) {
            throw BizException.of(400, "父任务不属于本项目");
        }
        Set<UUID> sub = collectSubtree(task.getId(), rawList(tenantId, projectId));
        if (sub.contains(newParentId)) {
            throw BizException.of(400, "不能将任务移动到其子任务下");
        }
    }

    /** 被选为父级的若是叶子（普通任务），转为 summary 以启用汇总（与「加子任务」一致） */
    private void ensureParentIsSummary(UUID parentId, UUID tenantId) {
        if (parentId == null) {
            return;
        }
        PmTask parent = getByIdAndTenant(parentId, tenantId);
        if ("task".equals(parent.getType())) {
            parent.setType("summary");
            parent.setAssigneeIds(List.of());
            parent.setUpdatedAt(LocalDateTime.now());
            taskMapper.update(parent);
        }
    }

    /** 收集 rootId 及其全部子孙的 id 集合 */
    private Set<UUID> collectSubtree(UUID rootId, List<PmTask> all) {
        Set<UUID> ids = new HashSet<>();
        ids.add(rootId);
        boolean grew = true;
        while (grew) {
            grew = false;
            for (PmTask t : all) {
                if (t.getParentId() != null && ids.contains(t.getParentId()) && !ids.contains(t.getId())) {
                    ids.add(t.getId());
                    grew = true;
                }
            }
        }
        return ids;
    }

    /** 删除任务（连带软删除全部子孙 + 清除涉及这些任务的依赖） */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmTask task = getByIdAndTenant(id, tenantId);
        assertTaskVisible(task);   // 团队可见性校验
        UUID projectId = task.getProjectId();
        List<PmTask> all = rawList(tenantId, projectId);

        // 收集 id 及其全部子孙
        Set<UUID> toRemove = collectSubtree(id, all);
        List<UUID> removeIds = new ArrayList<>(toRemove);

        LocalDateTime now = LocalDateTime.now();
        // 批量软删任务子树（一条 SQL）；显式带 tenant_id 做隔离兜底
        UpdateChain.of(PmTask.class)
            .set(PmTask::getDeletedAt, now)
            .set(PmTask::getUpdatedAt, now)
            .where(PmTask::getTenantId).eq(tenantId)
            .and(PmTask::getId).in(removeIds)
            .and(PmTask::getDeletedAt).isNull()
            .update();

        // 批量软删涉及被删任务的依赖（前序、后续各一条 SQL；避免 OR 分组改变 tenant 隔离的优先级）
        UpdateChain.of(PmDependency.class)
            .set(PmDependency::getDeletedAt, now)
            .set(PmDependency::getUpdatedAt, now)
            .where(PmDependency::getTenantId).eq(tenantId)
            .and(PmDependency::getProjectId).eq(projectId)
            .and(PmDependency::getDeletedAt).isNull()
            .and(PmDependency::getPredecessorId).in(removeIds)
            .update();
        UpdateChain.of(PmDependency.class)
            .set(PmDependency::getDeletedAt, now)
            .set(PmDependency::getUpdatedAt, now)
            .where(PmDependency::getTenantId).eq(tenantId)
            .and(PmDependency::getProjectId).eq(projectId)
            .and(PmDependency::getDeletedAt).isNull()
            .and(PmDependency::getSuccessorId).in(removeIds)
            .update();

        // 级联软删被删任务集的评论 / 链接 / 挂任务的事件，防孤儿数据
        cascadeService.cascadeTasks(tenantId, toRemove);

        // 削除されたタスク自身の履歴はもう開けないので、親タスク側に「サブタスク削除」を残す
        activityService.recordChild(tenantId, task.getParentId(), projectId, task.getName(), false);

        recomputeProjectProgress(tenantId, projectId);
    }

    /** 切换某 summary 任务的折叠状态 */
    @Transactional
    public PmTask toggleCollapse(UUID id, UUID tenantId) {
        PmTask task = getByIdAndTenant(id, tenantId);
        assertTaskVisible(task);   // 团队可见性校验
        task.setCollapsed(!Boolean.TRUE.equals(task.getCollapsed()));
        task.setUpdatedAt(LocalDateTime.now());
        taskMapper.update(task);
        return task;
    }

    /** 项目内全部 summary 任务统一展开/折叠 */
    @Transactional
    public void setCollapsedAll(UUID tenantId, UUID projectId, boolean collapsed) {
        requireProject(projectId, tenantId);   // 团队可见性校验
        // 一条 SQL 批量更新本项目全部 summary 的折叠态；显式带 tenant_id 隔离兜底
        UpdateChain.of(PmTask.class)
            .set(PmTask::getCollapsed, collapsed)
            .set(PmTask::getUpdatedAt, LocalDateTime.now())
            .where(PmTask::getTenantId).eq(tenantId)
            .and(PmTask::getProjectId).eq(projectId)
            .and(PmTask::getType).eq("summary")
            .and(PmTask::getDeletedAt).isNull()
            .update();
    }

    private PmProject requireProject(UUID projectId, UUID tenantId) {
        PmProject project = projectMapper.selectOneById(projectId);
        if (project == null || !project.getTenantId().equals(tenantId) || project.getDeletedAt() != null) {
            throw BizException.of(404, "项目不存在");
        }
        teamScope.assertTeamVisible(project.getTeamId());
        return project;
    }

    /**
     * 校验任务计划起止落在项目周期内（纯日期模型，闭区间）。
     * - end >= start；
     * - 任务 [start, end] 须落在项目 [start, end] 闭区间内。
     * 越界抛 BizException(400)。
     */
    private void validateWithinProject(PmProject project, LocalDate start, LocalDate end) {
        if (start == null || end == null) {
            return;
        }
        if (end.isBefore(start)) {
            throw BizException.of(400, "结束时间不能早于开始时间");
        }
        if (project.getStart() != null && start.isBefore(project.getStart())) {
            throw BizException.of(400, "任务开始时间早于项目周期");
        }
        if (project.getEnd() != null && end.isAfter(project.getEnd())) {
            throw BizException.of(400, "任务结束时间晚于项目周期");
        }
    }

    /** 进度防御性 clamp 到 0–100，兜底任何绕过 Controller 校验的越界值污染汇总 */
    private static int clampProgress(int progress) {
        return Math.max(0, Math.min(100, progress));
    }

    /**
     * 重新计算并回写项目整体进度（由任务汇总）。
     * サブを持つ親は「サブ＋親直下タスク」の加重集計、サブなら自分を書いたあと親も再計算する
     * （{@link PmProjectProgressService#recompute}）。
     */
    @Transactional
    public void recomputeProjectProgress(UUID tenantId, UUID projectId) {
        progressService.recompute(tenantId, projectId);
    }
}

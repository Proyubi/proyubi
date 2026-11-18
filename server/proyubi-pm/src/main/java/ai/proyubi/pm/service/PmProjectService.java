package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmCustomer;
import ai.proyubi.pm.domain.PmDependency;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmDependencyMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.update.UpdateChain;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 项目/版本Service（PM）
 *
 */
@Service
public class PmProjectService {

    private static final List<String> VALID_STATUS = List.of("planned", "active", "done", "paused");

    /** 项目种别：通常项目（固定范围）/ 运维保守（范围滚动、終了日未定を許す） */
    private static final String KIND_PROJECT = "project";
    private static final String KIND_OPS = "ops";
    private static final List<String> VALID_KIND = List.of(KIND_PROJECT, KIND_OPS);

    private final PmProjectMapper projectMapper;
    private final PmTaskMapper taskMapper;
    private final PmDependencyMapper dependencyMapper;
    private final PmCustomerService customerService;
    private final PmTeamScopeService teamScope;
    private final PmCascadeService cascadeService;
    private final TaskRollupService rollupService;
    private final PmHolidayService holidayService;
    private final PmSettingService settingService;

    public PmProjectService(PmProjectMapper projectMapper, PmTaskMapper taskMapper,
                            PmDependencyMapper dependencyMapper, PmCustomerService customerService,
                            PmTeamScopeService teamScope, PmCascadeService cascadeService,
                            TaskRollupService rollupService, PmHolidayService holidayService,
                            PmSettingService settingService) {
        this.projectMapper = projectMapper;
        this.taskMapper = taskMapper;
        this.dependencyMapper = dependencyMapper;
        this.customerService = customerService;
        this.teamScope = teamScope;
        this.cascadeService = cascadeService;
        this.rollupService = rollupService;
        this.holidayService = holidayService;
        this.settingService = settingService;
    }

    /** 列出当前租户、当前用户可见团队的项目（按客户分组由前端处理）。teamId 可选精确筛选某团队。 */
    public List<PmProject> list(UUID tenantId, UUID customerId, String status, UUID teamId) {
        List<UUID> teamIds = teamScope.resolveFilterTeamIds(teamId);
        if (teamIds != null && teamIds.isEmpty()) {
            return List.of();   // member 无可见团队 / 指定了不可见团队
        }
        QueryWrapper query = QueryWrapper.create()
            .where(PmProject::getTenantId).eq(tenantId)
            .and(PmProject::getDeletedAt).isNull();
        if (teamIds != null) {
            query.and(PmProject::getTeamId).in(teamIds);
        }
        if (customerId != null) {
            query.and(PmProject::getCustomerId).eq(customerId);
        }
        if (status != null && !status.isBlank()) {
            query.and(PmProject::getStatus).eq(status);
        }
        // 手动排序优先（sort_order 升序），同序号回退到创建时间倒序（新项目靠前）
        query.orderBy(PmProject::getSortOrder, true)
            .orderBy(PmProject::getCreatedAt, false);
        List<PmProject> projects = projectMapper.selectListByQuery(query);
        healProgress(tenantId, projects);
        return projects;
    }

    /**
     * 列表页自愈：列表页直接读缓存字段 {@code pm_project.progress}（不按项目加载任务），
     * 缓存仅在增/删/改任务时由 {@link PmTaskService#recomputeProjectProgress} 刷新——
     * 改假日日历、或历史上经绕过重算的路径完成任务，都会让缓存与实时汇总漂移。
     * <p>
     * 这里用一条 {@code IN} 批量查回所有列出项目的任务（避免 N 次查询），逐项目实时汇总，
     * 仅在 live≠cached 时回写并同步改本次返回对象，使列表页打开即显示正确进度。
     * 回写不触碰 updated_at（订正而非用户编辑）。稳态下无漂移即零写入。
     */
    private void healProgress(UUID tenantId, List<PmProject> projects) {
        if (projects.isEmpty()) {
            return;
        }
        List<UUID> ids = new ArrayList<>(projects.size());
        for (PmProject p : projects) {
            ids.add(p.getId());
        }
        List<PmTask> all = taskMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTask::getTenantId).eq(tenantId)
                .and(PmTask::getProjectId).in(ids)
                .and(PmTask::getDeletedAt).isNull()
                .orderBy(PmTask::getOrder, true)
        );
        Map<UUID, List<PmTask>> byProject = new HashMap<>();
        for (PmTask t : all) {
            byProject.computeIfAbsent(t.getProjectId(), k -> new ArrayList<>()).add(t);
        }
        Set<LocalDate> holidays = holidayService.getHolidayDates(tenantId);
        double hoursPerDay = settingService.getHoursPerWorkday(tenantId);
        for (PmProject p : projects) {
            List<PmTask> tasks = byProject.get(p.getId());
            List<PmTask> list = tasks != null ? tasks : new ArrayList<>();
            int live = rollupService.projectProgress(list, holidays, hoursPerDay);
            int cached = p.getProgress() != null ? p.getProgress() : 0;
            if (live != cached) {
                UpdateChain.of(PmProject.class)
                    .set(PmProject::getProgress, live)
                    .where(PmProject::getId).eq(p.getId())
                    .update();
                p.setProgress(live);   // 同步本次响应，列表页立即显示订正值
            }
            // 総工期（予定/実績・分钟）：不落库、每次响应实时集计（甘特 footer 展示用）。
            // 与 progress 同套 rollup 口径；tasks 已由上面一条 IN 批量查回，几乎零额外成本。
            TaskRollupService.EffortTotals totals = rollupService.projectEffortTotals(list, holidays, hoursPerDay);
            p.setPlannedTotalMinutes(totals.planned());
            p.setActualTotalMinutes(totals.actual());
            fillOpsCounts(p, list, holidays, hoursPerDay);
        }
    }

    /**
     * 運用型プロジェクト（kind=ops）の一覧表示用の件数を詰める。
     * <p>
     * 進捗率（工期加重）は分母＝これまでに作った全タスクなので、随時タスクが増える保守案件では
     * 「新しい依頼が来る度に下がる」鋸歯状になり、達成率としては読めない。代わりに保守の実務で
     * 使われるフロー指標を返す：
     * <ul>
     *   <li>{@code openTaskCount} — 未完了の葉タスク件数（全期間）＝滞留</li>
     *   <li>{@code monthTotalCount} / {@code monthDoneCount} — 予定終了日が当月の葉タスクと、その完了数</li>
     * </ul>
     * どちらも分母が当月で閉じる／分母を持たないため、月が変わる以外では数字が揺れない。
     * summary は葉の集計でしかないので除外、cancelled は件数に数えない。
     */
    private void fillOpsCounts(PmProject project, List<PmTask> tasks, Set<LocalDate> holidays, double hoursPerDay) {
        if (!KIND_OPS.equals(currentKind(project))) {
            return;   // 通常项目は進捗バー表示のままなので集計しない
        }
        LocalDate today = LocalDate.now();
        LocalDate monthStart = today.withDayOfMonth(1);
        LocalDate monthEnd = monthStart.plusMonths(1).minusDays(1);
        // 子を持つタスクは集計対象外（type が 'task' のまま子をぶら下げた実質 summary も弾く）
        Set<UUID> parentIds = new java.util.HashSet<>();
        for (PmTask t : tasks) {
            if (t.getParentId() != null) {
                parentIds.add(t.getParentId());
            }
        }
        int open = 0;
        int monthTotal = 0;
        int monthDone = 0;
        for (PmTask t : tasks) {
            if (parentIds.contains(t.getId()) || "cancelled".equals(t.getStatus())) {
                continue;
            }
            boolean done = (t.getProgress() != null && t.getProgress() >= 100) || "done".equals(t.getStatus());
            if (!done) {
                open++;
            }
            LocalDate end = t.getEnd();
            if (end != null && !end.isBefore(monthStart) && !end.isAfter(monthEnd)) {
                monthTotal++;
                if (done) {
                    monthDone++;
                }
            }
        }
        project.setOpenTaskCount(open);
        project.setMonthTotalCount(monthTotal);
        project.setMonthDoneCount(monthDone);
        // 今月の消化工数（実績）と見込み（予定）。件数と同じ母集団＝予定終了日が当月の葉タスク
        TaskRollupService.EffortTotals month =
            rollupService.monthEffortTotals(tasks, holidays, hoursPerDay, monthStart, monthEnd);
        project.setMonthPlannedMinutes(month.planned());
        project.setMonthActualMinutes(month.actual());
    }

    public PmProject getByIdAndTenant(UUID id, UUID tenantId) {
        PmProject project = projectMapper.selectOneById(id);
        if (project == null || !project.getTenantId().equals(tenantId) || project.getDeletedAt() != null) {
            throw BizException.of(404, "项目不存在");
        }
        teamScope.assertTeamVisible(project.getTeamId());
        return project;
    }

    @Transactional
    public PmProject create(UUID tenantId, UUID customerId, String name, String description,
                            String status, String kind, LocalDate start, LocalDate end,
                            Integer monthlyQuotaMinutes) {
        PmCustomer customer = customerService.getByIdAndTenant(customerId, tenantId); // 校验客户归属 + 团队可见
        String normalizedStatus = normalizeStatus(status);
        String normalizedKind = normalizeKind(kind);
        validateRange(normalizedKind, start, end);
        PmProject project = new PmProject();
        project.setId(UUID.randomUUID());
        project.setTenantId(tenantId);
        project.setCustomerId(customerId);
        project.setTeamId(customer.getTeamId());   // 项目团队从所属客户继承
        project.setName(name);
        project.setDescription(description);
        project.setStatus(normalizedStatus);
        project.setKind(normalizedKind);
        project.setStart(start);
        project.setEnd(end);
        project.setMonthlyQuotaMinutes(normalizeQuota(monthlyQuotaMinutes));
        project.setProgress(0);
        // 新项目排到该客户最前（min - 1），与原「新建置顶」体验一致；无项目时为 0
        project.setSortOrder(minSortOrder(tenantId, customerId) - 1);
        project.setCreatedAt(LocalDateTime.now());
        project.setUpdatedAt(LocalDateTime.now());
        projectMapper.insert(project);
        return project;
    }

    /**
     * 部分更新。{@code clearEnd=true} で終了日を明示的に null（＝継続中）へ戻す
     * ——PATCH セマンティクスでは {@code end=null} は「未変更」と区別できないため。
     */
    @Transactional
    public PmProject update(UUID id, UUID tenantId, UUID customerId, String name, String description,
                            String status, String kind, LocalDate start, LocalDate end, boolean clearEnd,
                            Integer monthlyQuotaMinutes) {
        PmProject project = getByIdAndTenant(id, tenantId);
        if (customerId != null) {
            PmCustomer customer = customerService.getByIdAndTenant(customerId, tenantId);
            project.setCustomerId(customerId);
            project.setTeamId(customer.getTeamId());   // 换客户时同步团队归属
        }
        if (name != null) project.setName(name);
        if (description != null) project.setDescription(description);
        if (status != null) project.setStatus(normalizeStatus(status));
        if (kind != null) project.setKind(normalizeKind(kind));
        if (start != null) project.setStart(start);
        if (clearEnd) {
            project.setEnd(null);
        } else if (end != null) {
            project.setEnd(end);
        }
        boolean clearQuota = false;
        if (monthlyQuotaMinutes != null) {
            Integer quota = normalizeQuota(monthlyQuotaMinutes);
            clearQuota = quota == null;   // 0 以下＝枠なしへ戻す
            project.setMonthlyQuotaMinutes(quota);
        }
        validateRange(currentKind(project), project.getStart(), project.getEnd());
        project.setUpdatedAt(LocalDateTime.now());
        // 既定は「非 null 列だけ更新」。null を書きに行く必要があるとき（終了日/工数枠のクリア）だけ
        // ignoreNulls を外す（entity は selectOneById で全列ロード済みなので他列は元値のまま書き戻る）
        projectMapper.update(project, !(clearEnd || clearQuota));
        return project;
    }

    /**
     * 拖动排序：按给定顺序重写同一客户下项目的 sort_order（0..n-1）。
     * 仅处理传入且属于该租户的有效项目；非法/越权 id 静默跳过。
     */
    @Transactional
    public void reorder(UUID tenantId, UUID customerId, List<UUID> orderedIds) {
        if (orderedIds == null || orderedIds.isEmpty()) {
            return;
        }
        customerService.getByIdAndTenant(customerId, tenantId); // 校验客户归属
        LocalDateTime now = LocalDateTime.now();
        int order = 0;
        for (UUID id : orderedIds) {
            PmProject project = projectMapper.selectOneById(id);
            if (project == null || project.getDeletedAt() != null
                || !tenantId.equals(project.getTenantId())
                || !customerId.equals(project.getCustomerId())) {
                continue;
            }
            project.setSortOrder(order++);
            project.setUpdatedAt(now);
            projectMapper.update(project);
        }
    }

    /** 该客户下现有项目的最小 sort_order（无项目返回 0，NULL 视为 0）。 */
    private int minSortOrder(UUID tenantId, UUID customerId) {
        List<PmProject> existing = projectMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getCustomerId).eq(customerId)
                .and(PmProject::getDeletedAt).isNull()
        );
        int min = 0;
        for (PmProject p : existing) {
            int so = p.getSortOrder() != null ? p.getSortOrder() : 0;
            if (so < min) {
                min = so;
            }
        }
        return min;
    }

    /** 删除项目（连带软删除其任务与依赖） */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmProject project = getByIdAndTenant(id, tenantId);
        LocalDateTime now = LocalDateTime.now();

        List<PmTask> tasks = taskMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTask::getTenantId).eq(tenantId)
                .and(PmTask::getProjectId).eq(id)
                .and(PmTask::getDeletedAt).isNull()
        );
        List<UUID> taskIds = new java.util.ArrayList<>(tasks.size());
        for (PmTask t : tasks) {
            t.setDeletedAt(now);
            t.setUpdatedAt(now);
            taskMapper.update(t);
            taskIds.add(t.getId());
        }

        List<PmDependency> deps = dependencyMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmDependency::getTenantId).eq(tenantId)
                .and(PmDependency::getProjectId).eq(id)
                .and(PmDependency::getDeletedAt).isNull()
        );
        for (PmDependency dep : deps) {
            dep.setDeletedAt(now);
            dep.setUpdatedAt(now);
            dependencyMapper.update(dep);
        }

        // 级联软删该项目下的评论 / 链接 / 事件（含项目级全局事件），防孤儿数据
        cascadeService.cascadeProject(tenantId, id, taskIds);

        project.setDeletedAt(now);
        project.setUpdatedAt(now);
        projectMapper.update(project);
    }

    private String normalizeStatus(String status) {
        if (status == null || status.isBlank()) {
            return "planned";
        }
        if (!VALID_STATUS.contains(status)) {
            throw BizException.of(400, "非法的项目状态：" + status);
        }
        return status;
    }

    /** 存量项目の kind は null（migration 前のレコード）→ 通常项目とみなす */
    private String currentKind(PmProject project) {
        String kind = project.getKind();
        return kind == null || kind.isBlank() ? KIND_PROJECT : kind;
    }

    /** 月次工数枠：0 以下は「枠なし」＝null に寄せる（0 人日の枠は意味を持たないため） */
    private Integer normalizeQuota(Integer minutes) {
        return minutes == null || minutes <= 0 ? null : minutes;
    }

    private String normalizeKind(String kind) {
        if (kind == null || kind.isBlank()) {
            return KIND_PROJECT;
        }
        if (!VALID_KIND.contains(kind)) {
            throw BizException.of(400, "非法的项目种别：" + kind);
        }
        return kind;
    }

    /**
     * 期間の妥当性：ops 型のみ終了日 null（＝継続中）を許す。
     * 両端が揃っている場合は前後関係も見る。
     */
    private void validateRange(String kind, LocalDate start, LocalDate end) {
        if (end == null && !KIND_OPS.equals(kind)) {
            throw BizException.of(400, "通常项目必须设置结束日期");
        }
        if (start != null && end != null && end.isBefore(start)) {
            throw BizException.of(400, "结束日期不能早于开始日期");
        }
    }
}

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
    private final PmProjectProgressService progressService;

    public PmProjectService(PmProjectMapper projectMapper, PmTaskMapper taskMapper,
                            PmDependencyMapper dependencyMapper, PmCustomerService customerService,
                            PmTeamScopeService teamScope, PmCascadeService cascadeService,
                            TaskRollupService rollupService, PmHolidayService holidayService,
                            PmSettingService settingService, PmProjectProgressService progressService) {
        this.progressService = progressService;
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
     * <p>
     * サブプロジェクト対応：まずサブを持たない案件（サブ自身を含む）を自分のタスクで集計し、
     * そのあと親を「サブ（予定工数で加重）＋親直下タスク」の集計分岐
     * （{@link TaskRollupService#parentProgress}）で求める。一覧に親だけ載ってサブが載っていない
     * （status 絞り込み等）場合でも親の集計が正しくなるよう、サブを 1 クエリで補完して読む。
     */
    private void healProgress(UUID tenantId, List<PmProject> projects) {
        if (projects.isEmpty()) {
            return;
        }
        Set<UUID> listedIds = new java.util.HashSet<>();
        for (PmProject p : projects) {
            listedIds.add(p.getId());
        }
        // 一覧に載っていないサブ（親の集計に必要）を補完
        List<PmProject> all = new ArrayList<>(projects);
        for (PmProject c : projectMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getParentId).in(listedIds)
                .and(PmProject::getDeletedAt).isNull())) {
            if (!listedIds.contains(c.getId())) {
                all.add(c);
            }
        }
        Map<UUID, List<PmProject>> childrenByParent = new HashMap<>();
        List<UUID> ids = new ArrayList<>(all.size());
        for (PmProject p : all) {
            ids.add(p.getId());
            if (p.getParentId() != null) {
                childrenByParent.computeIfAbsent(p.getParentId(), k -> new ArrayList<>()).add(p);
            }
        }
        List<PmTask> allTasks = taskMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTask::getTenantId).eq(tenantId)
                .and(PmTask::getProjectId).in(ids)
                .and(PmTask::getDeletedAt).isNull()
                .orderBy(PmTask::getOrder, true)
        );
        Map<UUID, List<PmTask>> byProject = new HashMap<>();
        for (PmTask t : allTasks) {
            byProject.computeIfAbsent(t.getProjectId(), k -> new ArrayList<>()).add(t);
        }
        // Read-only response metadata includes children even when only a parent is listed.
        PmProjectActivityRules.populate(all, allTasks);
        Set<LocalDate> holidays = holidayService.getHolidayDates(tenantId);
        double hoursPerDay = settingService.getHoursPerWorkday(tenantId);
        Map<UUID, Integer> liveById = new HashMap<>();
        // 1) サブを持たない案件（サブ自身を含む）
        for (PmProject p : all) {
            if (childrenByParent.containsKey(p.getId())) {
                continue;
            }
            List<PmTask> list = byProject.getOrDefault(p.getId(), new ArrayList<>());
            int live = rollupService.projectProgress(list, holidays, hoursPerDay);
            liveById.put(p.getId(), live);
            if (p.getParentId() != null) {
                p.setRollupWeightMinutes(
                    rollupService.subProjectWeight(p.getStart(), p.getEnd(), list, holidays, hoursPerDay));
            }
            if (listedIds.contains(p.getId())) {
                healOne(p, live);
                fillTotals(p, list, holidays, hoursPerDay);
            }
        }
        // 2) 親：サブの重み × 進捗 ＋ 親直下タスク
        for (PmProject p : projects) {
            List<PmProject> children = childrenByParent.get(p.getId());
            if (children == null) {
                continue;
            }
            List<TaskRollupService.WeightedProgress> subs = new ArrayList<>(children.size());
            for (PmProject c : children) {
                long weight = c.getRollupWeightMinutes() != null ? c.getRollupWeightMinutes() : 0L;
                subs.add(new TaskRollupService.WeightedProgress(weight, liveById.getOrDefault(c.getId(), 0)));
            }
            List<PmTask> own = byProject.getOrDefault(p.getId(), new ArrayList<>());
            int live = rollupService.parentProgress(own, subs, holidays, hoursPerDay);
            healOne(p, live);
            fillTotals(p, own, holidays, hoursPerDay);
        }
    }

    /** live≠cached のときだけ回写し、本次响应にも反映（updated_at は触らない）。 */
    private void healOne(PmProject p, int live) {
        int cached = p.getProgress() != null ? p.getProgress() : 0;
        if (live != cached) {
            UpdateChain.of(PmProject.class)
                .set(PmProject::getProgress, live)
                .where(PmProject::getId).eq(p.getId())
                .update();
            p.setProgress(live);   // 同步本次响应，列表页立即显示订正值
        }
    }

    /**
     * 総工期（予定/実績・分钟）：不落库、每次响应实时集计（甘特 footer 展示用）。
     * 与 progress 同套 rollup 口径；tasks 已由一条 IN 批量查回，几乎零额外成本。親は自分直下のタスクのみ。
     */
    private void fillTotals(PmProject p, List<PmTask> list, Set<LocalDate> holidays, double hoursPerDay) {
        TaskRollupService.EffortTotals totals = rollupService.projectEffortTotals(list, holidays, hoursPerDay);
        p.setPlannedTotalMinutes(totals.planned());
        p.setActualTotalMinutes(totals.actual());
        fillOpsCounts(p, list, holidays, hoursPerDay);
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

    /**
     * 新規作成。{@code parentId} 指定時はサブプロジェクトとして作る：
     * 親の検証（{@link PmProjectHierarchyRules#validateParent}）のうえ、customerId / teamId は親で上書き、
     * kind は親（＝project）を継承。並び順は同じ親のサブの末尾。作成後に親の進捗を再計算する。
     */
    @Transactional
    public PmProject create(UUID tenantId, UUID customerId, String name, String description,
                            String status, String kind, LocalDate start, LocalDate end,
                            Integer monthlyQuotaMinutes, UUID parentId) {
        PmProject parent = null;
        if (parentId != null) {
            parent = projectMapper.selectOneById(parentId);
            PmProjectHierarchyRules.validateParent(null, false,
                kind == null || kind.isBlank() ? null : normalizeKind(kind), tenantId, parent);
            teamScope.assertTeamVisible(parent.getTeamId());
            customerId = parent.getCustomerId();   // サブの顧客は親に揃える（サーバー側で上書き）
        }
        if (customerId == null) {
            throw BizException.of(400, "顧客 / 製品を指定してください");
        }
        PmCustomer customer = customerService.getByIdAndTenant(customerId, tenantId); // 校验客户归属 + 团队可见
        String normalizedStatus = normalizeStatus(status);
        String normalizedKind = parent != null ? KIND_PROJECT : normalizeKind(kind);
        if (start == null) {
            start = LocalDate.now();   // 開始日の省略＝作成当日（start_date は not null）
        }
        validateRange(start, end);
        PmProject project = new PmProject();
        project.setId(UUID.randomUUID());
        project.setTenantId(tenantId);
        project.setCustomerId(customerId);
        project.setParentId(parentId);
        // 项目团队从所属客户继承（サブは親の team に揃える）
        project.setTeamId(parent != null ? parent.getTeamId() : customer.getTeamId());
        project.setName(name);
        project.setDescription(description);
        project.setStatus(normalizedStatus);
        project.setKind(normalizedKind);
        project.setStart(start);
        project.setEnd(end);
        project.setMonthlyQuotaMinutes(normalizeQuota(monthlyQuotaMinutes));
        project.setProgress(0);
        // 新项目排到该客户最前（min - 1），与原「新建置顶」体验一致；无项目时为 0。
        // サブは同じ親のサブの末尾（フェーズ順に足していく使い方が自然なため）。
        project.setSortOrder(parentId != null
            ? maxChildSortOrder(tenantId, parentId) + 1
            : minSortOrder(tenantId, customerId) - 1);
        project.setCreatedAt(LocalDateTime.now());
        project.setUpdatedAt(LocalDateTime.now());
        projectMapper.insert(project);
        if (parentId != null) {
            progressService.recomputeParent(tenantId, parentId);   // サブが増えると親の重みが変わる
        }
        return project;
    }

    /**
     * 部分更新。{@code clearEnd=true} で終了日を明示的に null（＝継続中）へ戻す
     * ——PATCH セマンティクスでは {@code end=null} は「未変更」と区別できないため。
     * <p>
     * 親の付け替え：{@code parentId} 指定でその親のサブへ（同じ顧客内のみ）、{@code clearParent=true} で
     * トップレベルへ戻す。サブの customerId / teamId は親で上書き、サブを持つ親が顧客を変えたらサブも追従。
     * 付け替え・期間変更の後は旧親/新親の進捗を再計算する。
     */
    @Transactional
    public PmProject update(UUID id, UUID tenantId, UUID customerId, String name, String description,
                            String status, String kind, LocalDate start, LocalDate end, boolean clearEnd,
                            Integer monthlyQuotaMinutes, UUID parentId, boolean clearParent) {
        PmProject project = getByIdAndTenant(id, tenantId);
        UUID oldParentId = project.getParentId();
        UUID oldCustomerId = project.getCustomerId();
        UUID oldTeamId = project.getTeamId();
        boolean hasChildren = oldParentId == null && progressService.childCount(tenantId, id) > 0;
        String newKind = kind != null ? normalizeKind(kind) : currentKind(project);

        // 1) 親の付け替え
        PmProject parent = null;
        boolean parentChanged = false;
        if (clearParent) {
            if (oldParentId != null) {
                project.setParentId(null);
                parentChanged = true;
            }
        } else if (parentId != null && !parentId.equals(oldParentId)) {
            parent = projectMapper.selectOneById(parentId);
            PmProjectHierarchyRules.validateParent(id, hasChildren, newKind, tenantId, parent);
            teamScope.assertTeamVisible(parent.getTeamId());
            PmProjectHierarchyRules.validateSameCustomer(project.getCustomerId(), parent);
            project.setParentId(parentId);
            parentChanged = true;
        } else if (oldParentId != null) {
            parent = projectMapper.selectOneById(oldParentId);
            PmProjectHierarchyRules.validateParent(id, hasChildren, newKind, tenantId, parent);
            teamScope.assertTeamVisible(parent.getTeamId());
        }

        // 2) 顧客 / 团队：サブは親に揃える。トップレベルは従来どおり
        if (project.getParentId() != null && parent != null) {
            if (customerId != null && !customerId.equals(parent.getCustomerId())) {
                throw BizException.of(400,
                    "サブプロジェクトの顧客 / 製品は親プロジェクトと同じです。変更する場合は先に親プロジェクトから外してください");
            }
            project.setCustomerId(parent.getCustomerId());
            project.setTeamId(parent.getTeamId());
        } else if (customerId != null) {
            PmCustomer customer = customerService.getByIdAndTenant(customerId, tenantId);
            project.setCustomerId(customerId);
            project.setTeamId(customer.getTeamId());   // 换客户时同步团队归属
        }

        // 3) kind：サブは ops 不可、サブを持つ親も ops 不可（v1）
        if (project.getParentId() != null && KIND_OPS.equals(newKind)) {
            throw BizException.of(400, "サブプロジェクトを運用・保守にはできません");
        }
        PmProjectHierarchyRules.validateKindChangeForParent(hasChildren, newKind);

        if (parentChanged) {
            project.setSortOrder(project.getParentId() != null
                ? maxChildSortOrder(tenantId, project.getParentId()) + 1
                : minSortOrder(tenantId, project.getCustomerId()) - 1);
        }
        if (name != null) project.setName(name);
        if (description != null) project.setDescription(description);
        if (status != null) project.setStatus(normalizeStatus(status));
        if (kind != null) project.setKind(newKind);
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
        validateRange(project.getStart(), project.getEnd());
        project.setUpdatedAt(LocalDateTime.now());
        // 既定は「非 null 列だけ更新」。null を書きに行く必要があるとき（終了日/工数枠/親のクリア）だけ
        // ignoreNulls を外す（entity は selectOneById で全列ロード済みなので他列は元値のまま書き戻る）
        boolean clearedParent = parentChanged && project.getParentId() == null;
        boolean clearedTeam = oldTeamId != null && project.getTeamId() == null;
        projectMapper.update(project, !(clearEnd || clearQuota || clearedParent || clearedTeam));

        // サブを持つ親が顧客を変えたら、サブの customer / team も追従（サブは常に親と同じ顧客）
        if (hasChildren && !project.getCustomerId().equals(oldCustomerId)) {
            UpdateChain.of(PmProject.class)
                .set(PmProject::getCustomerId, project.getCustomerId())
                .set(PmProject::getTeamId, project.getTeamId())
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getParentId).eq(id)
                .and(PmProject::getDeletedAt).isNull()
                .update();
        }
        // 親の集計：付け替えなら旧親/新親、サブの期間変更なら（タスク無しサブの重みが変わるので）現親
        if (oldParentId != null && !oldParentId.equals(project.getParentId())) {
            progressService.recomputeParent(tenantId, oldParentId);
        }
        if (project.getParentId() != null) {
            progressService.recomputeParent(tenantId, project.getParentId());
        }
        if (clearedParent || hasChildren) {
            // トップレベルに戻した案件は自分のタスクだけの値に、親は集計値に（期間変更は親自身には影響しないが念のため）
            progressService.recompute(tenantId, id);
        }
        return project;
    }

    /**
     * 拖动排序：按给定顺序重写同一阶层内项目的 sort_order（0..n-1）。
     * {@code parentId=null} ＝该客户的トップレベル同士、指定時＝その親のサブ同士。
     * 階層をまたぐ ID（トップレベルの並べ替えに混ざったサブ等）・非法/越权 id 静默跳过。
     */
    @Transactional
    public void reorder(UUID tenantId, UUID customerId, List<UUID> orderedIds, UUID parentId) {
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
                || !customerId.equals(project.getCustomerId())
                || !PmProjectHierarchyRules.sameLevel(project, parentId)) {
                continue;
            }
            project.setSortOrder(order++);
            project.setUpdatedAt(now);
            projectMapper.update(project);
        }
    }

    /** 该客户下现有トップレベル项目的最小 sort_order（无项目返回 0，NULL 视为 0）。 */
    private int minSortOrder(UUID tenantId, UUID customerId) {
        List<PmProject> existing = projectMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getCustomerId).eq(customerId)
                .and(PmProject::getParentId).isNull()
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

    /** 同じ親のサブの最大 sort_order（サブが無ければ -1 → 先頭は 0）。 */
    private int maxChildSortOrder(UUID tenantId, UUID parentId) {
        int max = -1;
        for (PmProject p : progressService.children(tenantId, parentId)) {
            int so = p.getSortOrder() != null ? p.getSortOrder() : 0;
            if (so > max) {
                max = so;
            }
        }
        return max;
    }

    /** 删除项目（连带软删除其任务与依赖）。サブ（未削除）を持つ親は削除不可。 */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmProject project = getByIdAndTenant(id, tenantId);
        PmProjectHierarchyRules.validateDeletable(progressService.childCount(tenantId, id));
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
        if (project.getParentId() != null) {
            progressService.recomputeParent(tenantId, project.getParentId());   // サブが減ると親の集計が変わる
        }
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
     * 期間の妥当性：終了日は種別を問わず任意（null＝期限なし。期限超過の判定もしない）。
     * 両端が揃っている場合は前後関係だけを見る。
     */
    private void validateRange(LocalDate start, LocalDate end) {
        if (start != null && end != null && end.isBefore(start)) {
            throw BizException.of(400, "结束日期不能早于开始日期");
        }
    }
}

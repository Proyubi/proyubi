package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmBug;
import ai.proyubi.pm.domain.PmCustomer;
import ai.proyubi.pm.domain.PmDependency;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmBugMapper;
import ai.proyubi.pm.mapper.PmCustomerMapper;
import ai.proyubi.pm.mapper.PmDependencyMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import ai.proyubi.pm.vo.PmCalendarVO;
import ai.proyubi.pm.vo.PmOverviewVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * PM 俯瞰页聚合Service。
 * 服务端一次性计算 KPI / 风险一览 / 项目健康 / 近期里程碑，规则对齐
 * doc/requirements/overview.md §5，并与前端 src/pm/utils/risk.ts 保持一致。
 * <p>
 * 相比前端基于 /workload（仅含有指派任务）的 MVP，这里基于「全部任务」评估，
 * 因此「未割当」「依存ブロック」可被正确算出。
 *
 */
@Service
public class PmOverviewService {

    private static final Logger log = LoggerFactory.getLogger(PmOverviewService.class);

    // 风险阈值（见 §5）
    private static final int BEHIND_GAP_PCT = 15;
    private static final int DUE_SOON_DAYS_TASK = 7;
    private static final int DUE_SOON_DAYS_MILESTONE = 14;
    private static final int UNASSIGNED_LEAD_DAYS = 7;
    private static final int BLOCKED_LEAD_DAYS = 3;
    private static final int MILESTONE_WINDOW_DAYS = 14;

    // 多风险命中时徽标取优先级最高者
    private static final List<String> RISK_PRIORITY =
        List.of("overdue", "blocked", "behind", "due-soon", "unassigned");

    // 「未完了」バグ（前端 pm/utils/bug.ts の ACTIVE_BUG_STATUSES と一致）
    private static final List<String> ACTIVE_BUG_STATUSES =
        List.of("open", "in_progress", "resolved", "verifying");
    private static final List<String> SEVERITY_ORDER = List.of("high", "medium", "low");

    private final PmTaskMapper taskMapper;
    private final PmProjectMapper projectMapper;
    private final PmCustomerMapper customerMapper;
    private final PmDependencyMapper dependencyMapper;
    private final PmTeamScopeService teamScope;
    private final PmHolidayService holidayService;
    private final PmMemberResolver memberResolver;
    private final PmBugMapper bugMapper;

    public PmOverviewService(PmTaskMapper taskMapper, PmProjectMapper projectMapper,
                             PmCustomerMapper customerMapper, PmDependencyMapper dependencyMapper,
                             PmTeamScopeService teamScope, PmHolidayService holidayService,
                             PmMemberResolver memberResolver, PmBugMapper bugMapper) {
        this.taskMapper = taskMapper;
        this.projectMapper = projectMapper;
        this.customerMapper = customerMapper;
        this.dependencyMapper = dependencyMapper;
        this.teamScope = teamScope;
        this.holidayService = holidayService;
        this.memberResolver = memberResolver;
        this.bugMapper = bugMapper;
    }

    /**
     * 俯瞰聚合。
     *
     * @param tenantId 租户
     * @param userId   当前登录用户（用于解析「本人」成员）
     * @param scope    "all"=全社俯瞰；"me"=仅本人担当
     */
    public PmOverviewVO overview(UUID tenantId, UUID userId, String scope) {
        boolean meScope = "me".equalsIgnoreCase(scope);
        LocalDate today = LocalDate.now();

        // 解析「本人」成员（始终返回，供前端默认选中）
        String meMemberId = resolveMeMemberId(tenantId, userId);

        // me 视角但用户未绑定 PM 成员 → 空数据
        if (meScope && meMemberId == null) {
            return new PmOverviewVO(null,
                new PmOverviewVO.Kpis(0, 0, 0, 0, 0, 0, 0, 0, 0),
                List.of(), List.of(), List.of(), List.of(), 0, List.of(), List.of());
        }

        // 基础数据：全部未删除任务 / 项目 / 客户 / 依赖
        List<PmTask> allTasks = taskMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTask::getTenantId).eq(tenantId)
                .and(PmTask::getDeletedAt).isNull());
        Map<UUID, PmProject> projectMap = new HashMap<>();
        for (PmProject p : projectMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getDeletedAt).isNull())) {
            projectMap.put(p.getId(), p);
        }
        Map<UUID, PmCustomer> customerMap = new HashMap<>();
        for (PmCustomer c : customerMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmCustomer::getTenantId).eq(tenantId)
                .and(PmCustomer::getDeletedAt).isNull())) {
            customerMap.put(c.getId(), c);
        }

        // 多团队隔离：member 仅看可见团队的项目；owner/内部上下文 visibleTeams=null（不限制）。
        // team_id 为 null 的历史项目视为可见（与 assertTeamVisible 语义一致）。
        List<UUID> visibleTeams = teamScope.visibleTeamIds();
        if (visibleTeams != null) {
            Set<UUID> allowTeams = new java.util.HashSet<>(visibleTeams);
            projectMap.values().removeIf(p -> p.getTeamId() != null && !allowTeams.contains(p.getTeamId()));
            Set<UUID> allowedProjectIds = projectMap.keySet();
            allTasks.removeIf(t -> t.getProjectId() != null && !allowedProjectIds.contains(t.getProjectId()));
        }

        Map<UUID, PmTask> taskById = new HashMap<>();
        for (PmTask t : allTasks) {
            taskById.put(t.getId(), t);
        }
        // 依赖：successorId → 其前序任务列表
        Map<UUID, List<UUID>> predecessorsOf = new HashMap<>();
        for (PmDependency d : dependencyMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmDependency::getTenantId).eq(tenantId)
                .and(PmDependency::getDeletedAt).isNull())) {
            if (d.getSuccessorId() != null && d.getPredecessorId() != null) {
                predecessorsOf.computeIfAbsent(d.getSuccessorId(), k -> new ArrayList<>())
                    .add(d.getPredecessorId());
            }
        }

        // 工作日工期口径所需的租户红日子（behind 期望进度按工作日推算，与工期模型统一）
        Set<LocalDate> holidays = holidayService.getHolidayDates(tenantId);

        // 评估范围：me 视角仅本人担当的任务
        List<PmTask> scopeTasks = new ArrayList<>();
        Set<UUID> myProjectIds = new LinkedHashSet<>();
        for (PmTask t : allTasks) {
            boolean mine = t.getAssigneeIds() != null && t.getAssigneeIds().contains(meMemberId);
            if (meScope && !mine) {
                continue;
            }
            scopeTasks.add(t);
            if (t.getProjectId() != null) {
                myProjectIds.add(t.getProjectId());
            }
        }

        // 逐任务评估风险
        List<PmOverviewVO.RiskItem> riskItems = new ArrayList<>();
        Map<UUID, Integer> delayByProject = new HashMap<>();
        int kDelayedTasks = 0;
        int kDueSoon = 0;
        int kUnassigned = 0;
        int kBlocked = 0;
        Set<UUID> delayedProjectSet = new LinkedHashSet<>();

        for (PmTask t : scopeTasks) {
            Risk r = evaluate(t, taskById, predecessorsOf, today, holidays);
            if (r == null) {
                continue;
            }
            PmProject project = t.getProjectId() != null ? projectMap.get(t.getProjectId()) : null;
            PmCustomer customer = project != null && project.getCustomerId() != null
                ? customerMap.get(project.getCustomerId()) : null;

            // 「遅延」= 期限超過(overdue) のみ。進捗遅れ(behind) は別リスクとして一覧には出すが
            // 「遅延タスク/遅延案件」のカウントには含めない（end < today を過ぎたものだけが「遅延」）。
            boolean isDelay = r.risks.contains("overdue");
            if (isDelay) {
                kDelayedTasks++;
                if (t.getProjectId() != null) {
                    delayedProjectSet.add(t.getProjectId());
                    delayByProject.merge(t.getProjectId(), 1, Integer::sum);
                }
            }
            if (r.risks.contains("due-soon") && !r.risks.contains("overdue")) {
                kDueSoon++;
            }
            if (r.risks.contains("unassigned")) {
                kUnassigned++;
            }
            if (r.risks.contains("blocked")) {
                kBlocked++;
            }

            riskItems.add(new PmOverviewVO.RiskItem(
                t.getId().toString(),
                t.getName(),
                t.getType(),
                t.getProjectId() != null ? t.getProjectId().toString() : null,
                project != null ? project.getName() : null,
                customer != null ? customer.getId().toString() : null,
                customer != null ? customer.getName() : null,
                t.getAssigneeIds() != null ? t.getAssigneeIds() : List.of(),
                t.getStart() != null ? t.getStart().toString() : null,
                t.getEnd() != null ? t.getEnd().toString() : null,
                t.getProgress() != null ? t.getProgress() : 0,
                r.risks,
                r.risks.get(0),
                r.overdueDays,
                r.daysUntilDue
            ));
        }
        // 逾期天数降序 → 期日升序
        riskItems.sort(Comparator
            .comparingInt(PmOverviewVO.RiskItem::overdueDays).reversed()
            .thenComparing(ri -> ri.end() != null ? ri.end() : "9999-12-31"));

        // 项目健康
        List<PmProject> healthProjects = new ArrayList<>();
        if (meScope) {
            for (UUID pid : myProjectIds) {
                PmProject p = projectMap.get(pid);
                if (p != null) {
                    healthProjects.add(p);
                }
            }
        } else {
            for (PmProject p : projectMap.values()) {
                if ("active".equals(p.getStatus()) || delayByProject.containsKey(p.getId())) {
                    healthProjects.add(p);
                }
            }
        }
        List<PmOverviewVO.ProjectHealth> projectHealth = new ArrayList<>();
        for (PmProject p : healthProjects) {
            PmCustomer customer = p.getCustomerId() != null ? customerMap.get(p.getCustomerId()) : null;
            int delay = delayByProject.getOrDefault(p.getId(), 0);
            boolean overdue = !"done".equals(p.getStatus())
                && (p.getProgress() == null || p.getProgress() < 100)
                && p.getEnd() != null && p.getEnd().isBefore(today);
            projectHealth.add(new PmOverviewVO.ProjectHealth(
                p.getId().toString(),
                p.getName(),
                customer != null ? customer.getName() : null,
                p.getStatus(),
                p.getStart() != null ? p.getStart().toString() : null,
                p.getEnd() != null ? p.getEnd().toString() : null,
                p.getProgress() != null ? p.getProgress() : 0,
                delay,
                overdue
            ));
        }
        projectHealth.sort(Comparator
            .comparingInt(PmOverviewVO.ProjectHealth::delay).reversed()
            .thenComparingInt(PmOverviewVO.ProjectHealth::progress));

        // 近期里程碑（未完，14 天内或已超期）
        List<PmOverviewVO.Milestone> milestones = new ArrayList<>();
        for (PmTask t : scopeTasks) {
            if (!"milestone".equals(t.getType())) {
                continue;
            }
            int progress = t.getProgress() != null ? t.getProgress() : 0;
            if (progress >= 100 || t.getEnd() == null) {
                continue;
            }
            int diff = (int) ChronoUnit.DAYS.between(today, t.getEnd());
            if (diff > MILESTONE_WINDOW_DAYS) {
                continue;
            }
            PmProject project = t.getProjectId() != null ? projectMap.get(t.getProjectId()) : null;
            milestones.add(new PmOverviewVO.Milestone(
                t.getId().toString(),
                t.getName(),
                t.getProjectId() != null ? t.getProjectId().toString() : null,
                project != null ? project.getName() : null,
                t.getEnd().toString(),
                diff,
                progress
            ));
        }
        milestones.sort(Comparator.comparingInt(PmOverviewVO.Milestone::diff));

        // KPI: 进行中项目
        int activeProjects;
        if (meScope) {
            activeProjects = myProjectIds.size();
        } else {
            int n = 0;
            for (PmProject p : projectMap.values()) {
                if ("active".equals(p.getStatus())) {
                    n++;
                }
            }
            activeProjects = n;
        }

        // 进行中 / 本周任务（叶子 type==task；本周＝本周一～本周日）
        LocalDate weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate weekEnd = weekStart.plusDays(6);
        int kInProgress = 0;
        int kWeekTotal = 0;
        int kWeekDone = 0;
        for (PmTask t : scopeTasks) {
            if (!"task".equals(t.getType())) {
                continue;
            }
            int progress = t.getProgress() != null ? t.getProgress() : 0;
            LocalDate tStart = t.getStart();
            LocalDate tEnd = t.getEnd();
            // 进行中：已着手（today >= start）且未完成
            if (progress < 100 && tStart != null && !today.isBefore(tStart)) {
                kInProgress++;
            }
            // 本周任务：期日落在本周区间内
            if (tEnd != null && !tEnd.isBefore(weekStart) && !tEnd.isAfter(weekEnd)) {
                kWeekTotal++;
                if (progress >= 100) {
                    kWeekDone++;
                }
            }
        }

        PmOverviewVO.Kpis kpis = new PmOverviewVO.Kpis(
            activeProjects, delayedProjectSet.size(), kDelayedTasks, kDueSoon, kUnassigned, kBlocked,
            kInProgress, kWeekTotal, kWeekDone);

        // 担当者别任务分布（全社·叶子任务）：已分配按成员计数，未分配单独汇总。
        // 基于 allTasks（团队可见的全量任务，非 me 收窄后的 scopeTasks），与饼图「全社俯瞰」语义一致；
        // 无任何日期/风险过滤，分母与各片同源，修复旧版用风险型 kpis.unassigned 导致的口径失真。
        Map<String, Integer> distCounts = new java.util.LinkedHashMap<>();
        int unassignedTaskCount = 0;
        for (PmTask t : allTasks) {
            if (!"task".equals(t.getType())) {
                continue;
            }
            List<String> aids = t.getAssigneeIds();
            if (aids == null || aids.isEmpty()) {
                unassignedTaskCount++;
            } else {
                for (String mid : aids) {
                    distCounts.merge(mid, 1, Integer::sum);
                }
            }
        }
        List<PmOverviewVO.AssigneeCount> assigneeDistribution = new ArrayList<>();
        for (Map.Entry<String, Integer> e : distCounts.entrySet()) {
            assigneeDistribution.add(new PmOverviewVO.AssigneeCount(e.getKey(), e.getValue()));
        }

        // 排查「登录后担当显示成 UUID」：与 PmMemberService.list 的 tenant 比对，
        // 并打出饼图引用到的成员 ID，便于核对名册是否覆盖。复现后可删。
        log.warn("PM overview: tenant={}, scope={}, assigneeMemberIds={}, unassigned={}",
            tenantId, scope,
            assigneeDistribution.stream().map(PmOverviewVO.AssigneeCount::memberId).toList(),
            unassignedTaskCount);

        List<PmOverviewVO.MyTask> myTasks = meScope
            ? buildMyTasks(scopeTasks, taskById, predecessorsOf, projectMap, customerMap, today, weekEnd, holidays)
            : List.of();
        List<PmOverviewVO.MyBug> myBugs = meScope
            ? buildMyBugs(tenantId, meMemberId, customerMap)
            : List.of();

        return new PmOverviewVO(meMemberId, kpis, riskItems, projectHealth, milestones,
            assigneeDistribution, unassignedTaskCount, myTasks, myBugs);
    }

    /**
     * マイタスク：本人担当の未完了タスク（summary 除く）を期日バケットに振り分ける。
     * バケット境界（今日 / 今週末＝日曜）は KPI「今週のタスク」と同じ週定義。
     */
    private List<PmOverviewVO.MyTask> buildMyTasks(List<PmTask> scopeTasks, Map<UUID, PmTask> taskById,
                                                   Map<UUID, List<UUID>> predecessorsOf,
                                                   Map<UUID, PmProject> projectMap, Map<UUID, PmCustomer> customerMap,
                                                   LocalDate today, LocalDate weekEnd, Set<LocalDate> holidays) {
        List<PmOverviewVO.MyTask> rows = new ArrayList<>();
        for (PmTask t : scopeTasks) {
            if ("summary".equals(t.getType())) {
                continue;
            }
            int progress = t.getProgress() != null ? t.getProgress() : 0;
            if (progress >= 100) {
                continue;
            }
            LocalDate end = t.getEnd();
            Integer daysToDue = end != null ? (int) ChronoUnit.DAYS.between(today, end) : null;
            String bucket;
            if (daysToDue == null) {
                bucket = "later";
            } else if (daysToDue < 0) {
                bucket = "overdue";
            } else if (daysToDue == 0) {
                bucket = "today";
            } else if (!end.isAfter(weekEnd)) {
                bucket = "week";
            } else {
                bucket = "later";
            }
            Risk r = evaluate(t, taskById, predecessorsOf, today, holidays);
            PmProject project = t.getProjectId() != null ? projectMap.get(t.getProjectId()) : null;
            PmCustomer customer = project != null && project.getCustomerId() != null
                ? customerMap.get(project.getCustomerId()) : null;
            rows.add(new PmOverviewVO.MyTask(
                t.getId().toString(),
                t.getName(),
                t.getType(),
                t.getProjectId() != null ? t.getProjectId().toString() : null,
                project != null ? project.getName() : null,
                customer != null ? customer.getName() : null,
                t.getStart() != null ? t.getStart().toString() : null,
                end != null ? end.toString() : null,
                progress,
                bucket,
                daysToDue,
                r != null ? r.risks() : List.of()
            ));
        }
        // 期日昇順（期日なしは末尾）
        rows.sort(Comparator.comparing(PmOverviewVO.MyTask::end,
            Comparator.nullsLast(Comparator.naturalOrder())));
        return rows;
    }

    /**
     * マイバグ：本人担当の未完了バグ。影響度 高→低、同じなら起票の古い順。
     * バグは顧客（製品）単位でチーム分離が無いため、担当者本人であれば見せる。
     */
    private List<PmOverviewVO.MyBug> buildMyBugs(UUID tenantId, String meMemberId,
                                                 Map<UUID, PmCustomer> customerMap) {
        UUID memberId;
        try {
            memberId = UUID.fromString(meMemberId);
        } catch (IllegalArgumentException e) {
            return List.of();
        }
        List<PmBug> bugs = bugMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmBug::getTenantId).eq(tenantId)
                .and(PmBug::getAssigneeMemberId).eq(memberId)
                .and(PmBug::getStatus).in(ACTIVE_BUG_STATUSES)
                .and(PmBug::getDeletedAt).isNull());
        List<PmOverviewVO.MyBug> rows = new ArrayList<>();
        for (PmBug b : bugs) {
            PmCustomer customer = customerMap.get(b.getCustomerId());
            if (customer == null) {
                continue; // 顧客（製品）が削除済み
            }
            LocalDate reported = b.getReportedOn() != null ? b.getReportedOn()
                : b.getCreatedAt() != null ? b.getCreatedAt().toLocalDate() : null;
            rows.add(new PmOverviewVO.MyBug(
                b.getId().toString(),
                b.getCustomerId().toString(),
                customer.getName(),
                b.getSeq(),
                b.getBugNo(),
                b.getTitle(),
                b.getSeverity(),
                b.getStatus(),
                reported != null ? reported.toString() : null
            ));
        }
        rows.sort(Comparator
            .comparingInt((PmOverviewVO.MyBug b) -> {
                int i = SEVERITY_ORDER.indexOf(b.severity());
                return i < 0 ? SEVERITY_ORDER.size() : i;
            })
            .thenComparing(PmOverviewVO.MyBug::reportedOn, Comparator.nullsLast(Comparator.naturalOrder())));
        return rows;
    }

    /**
     * 日历视图：返回 [from, to] 区间内全部已排期叶子任务（type==task），各带命中的风险种别。
     * 复用 overview() 的任务加载、多团队隔离、scope=me 解析与 evaluate() 风险评估，规则零漂移。
     *
     * @param tenantId 租户
     * @param userId   当前登录用户（scope=me 时解析「本人」成员）
     * @param scope    "all"=全员（默认）；"me"=仅本人担当
     * @param from     区间起（含）
     * @param to       区间止（含）
     */
    public PmCalendarVO calendar(UUID tenantId, UUID userId, String scope, LocalDate from, LocalDate to) {
        boolean meScope = "me".equalsIgnoreCase(scope);
        LocalDate today = LocalDate.now();

        String meMemberId = resolveMeMemberId(tenantId, userId);

        // me 视角但用户未绑定 PM 成员 → 空数据
        if (meScope && meMemberId == null) {
            return new PmCalendarVO(null, List.of());
        }

        // 基础数据：全部未删除任务 / 项目（项目名用于格子展示）
        List<PmTask> allTasks = taskMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTask::getTenantId).eq(tenantId)
                .and(PmTask::getDeletedAt).isNull());
        Map<UUID, PmProject> projectMap = new HashMap<>();
        for (PmProject p : projectMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getDeletedAt).isNull())) {
            projectMap.put(p.getId(), p);
        }

        // 多团队隔离：member 仅看可见团队的项目（与 overview() 同口径）。
        List<UUID> visibleTeams = teamScope.visibleTeamIds();
        if (visibleTeams != null) {
            Set<UUID> allowTeams = new java.util.HashSet<>(visibleTeams);
            projectMap.values().removeIf(p -> p.getTeamId() != null && !allowTeams.contains(p.getTeamId()));
            Set<UUID> allowedProjectIds = projectMap.keySet();
            allTasks.removeIf(t -> t.getProjectId() != null && !allowedProjectIds.contains(t.getProjectId()));
        }

        Map<UUID, PmTask> taskById = new HashMap<>();
        for (PmTask t : allTasks) {
            taskById.put(t.getId(), t);
        }
        // 依赖：successorId → 其前序任务列表（blocked 风险评估需要）
        Map<UUID, List<UUID>> predecessorsOf = new HashMap<>();
        for (PmDependency d : dependencyMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmDependency::getTenantId).eq(tenantId)
                .and(PmDependency::getDeletedAt).isNull())) {
            if (d.getSuccessorId() != null && d.getPredecessorId() != null) {
                predecessorsOf.computeIfAbsent(d.getSuccessorId(), k -> new ArrayList<>())
                    .add(d.getPredecessorId());
            }
        }

        Set<LocalDate> holidays = holidayService.getHolidayDates(tenantId);

        List<PmCalendarVO.CalendarTask> tasks = new ArrayList<>();
        for (PmTask t : allTasks) {
            // 仅叶子普通任务（summary/milestone 不进日历）
            if (!"task".equals(t.getType())) {
                continue;
            }
            // me 视角：仅本人担当
            if (meScope && (t.getAssigneeIds() == null || !t.getAssigneeIds().contains(meMemberId))) {
                continue;
            }
            // 区间交集：start/end 齐全且与 [from, to] 相交
            LocalDate start = t.getStart();
            LocalDate end = t.getEnd();
            if (start == null || end == null || start.isAfter(to) || end.isBefore(from)) {
                continue;
            }
            Risk r = evaluate(t, taskById, predecessorsOf, today, holidays);
            List<String> riskKinds = r == null ? List.of() : r.risks();
            PmProject project = t.getProjectId() != null ? projectMap.get(t.getProjectId()) : null;
            tasks.add(new PmCalendarVO.CalendarTask(
                t.getId().toString(),
                t.getName(),
                start.toString(),
                end.toString(),
                t.getProgress() != null ? t.getProgress() : 0,
                t.getProjectId() != null ? t.getProjectId().toString() : null,
                project != null ? project.getName() : null,
                t.getAssigneeIds() != null ? t.getAssigneeIds() : List.of(),
                riskKinds
            ));
        }

        return new PmCalendarVO(meMemberId, tasks);
    }

    /** 当前登录用户对应的 pm_member.id（未绑定/未登录返回 null） */
    private String resolveMeMemberId(UUID tenantId, UUID userId) {
        return memberResolver.memberId(tenantId, userId);
    }

    /** 单任务风险评估；无风险返回 null */
    private Risk evaluate(PmTask t, Map<UUID, PmTask> taskById,
                          Map<UUID, List<UUID>> predecessorsOf, LocalDate today,
                          Set<LocalDate> holidays) {
        if ("summary".equals(t.getType())) {
            return null;
        }
        int progress = t.getProgress() != null ? t.getProgress() : 0;
        if (progress >= 100) {
            return null;
        }
        boolean isMilestone = "milestone".equals(t.getType());
        // 风险按「天」判定（逾期/还差几天是天级管理动作）；任务期间已是纯日期
        LocalDate start = t.getStart();
        LocalDate end = t.getEnd();

        List<String> risks = new ArrayList<>();
        int overdueDays = 0;
        Integer daysUntilDue = null;

        if (end != null) {
            long diffToEnd = ChronoUnit.DAYS.between(today, end); // >0 未到期, <0 已过期
            if (diffToEnd < 0) {
                risks.add("overdue");
                overdueDays = (int) -diffToEnd;
            } else {
                int window = isMilestone ? DUE_SOON_DAYS_MILESTONE : DUE_SOON_DAYS_TASK;
                if (diffToEnd <= window) {
                    risks.add("due-soon");
                    daysUntilDue = (int) diffToEnd;
                }
            }
        }

        // 依存ブロック：前序未完，且本任务着手将近、本身未完
        if (!isMilestone && progress < 100 && start != null
            && ChronoUnit.DAYS.between(today, start) <= BLOCKED_LEAD_DAYS) {
            List<UUID> preds = predecessorsOf.get(t.getId());
            if (preds != null) {
                for (UUID pid : preds) {
                    PmTask pre = taskById.get(pid);
                    int preProgress = pre != null && pre.getProgress() != null ? pre.getProgress() : 0;
                    if (pre != null && preProgress < 100) {
                        risks.add("blocked");
                        break;
                    }
                }
            }
        }

        // 进度滞后：普通任务、在计划期内、未逾期
        if (!isMilestone && start != null && end != null && overdueDays == 0) {
            boolean inRange = !today.isBefore(start) && !today.isAfter(end);
            if (inRange) {
                int expected = expectedProgress(start, end, today, holidays);
                if (progress < expected - BEHIND_GAP_PCT) {
                    risks.add("behind");
                }
            }
        }

        // 未割当：普通任务、无担当、着手将近
        if (!isMilestone && (t.getAssigneeIds() == null || t.getAssigneeIds().isEmpty())
            && start != null && ChronoUnit.DAYS.between(today, start) <= UNASSIGNED_LEAD_DAYS) {
            risks.add("unassigned");
        }

        if (risks.isEmpty()) {
            return null;
        }
        // 按优先级排序
        List<String> sorted = new ArrayList<>();
        for (String k : RISK_PRIORITY) {
            if (risks.contains(k)) {
                sorted.add(k);
            }
        }
        return new Risk(sorted, overdueDays, daysUntilDue);
    }

    /**
     * 期望进度：按<b>工作日</b>工期线性推算今日应达成的百分比，与 {@link TaskRollupService} 的
     * 工期口径统一（排除周末 + 租户红日子），避免跨周末/连休时高估应达成进度而误报 behind。
     */
    static int expectedProgress(LocalDate start, LocalDate end, LocalDate today, Set<LocalDate> holidays) {
        long total = TaskRollupService.workingDays(start, end, holidays);
        if (total <= 0) {
            return today.isBefore(start) ? 0 : 100;
        }
        // 已过工作日（含首尾，与 workingDays 同口径）；today 落在区间内由调用方保证
        LocalDate elapsedEnd = today.isAfter(end) ? end : today;
        long elapsed = TaskRollupService.workingDays(start, elapsedEnd, holidays);
        long pct = Math.round((double) elapsed / total * 100);
        return (int) Math.max(0, Math.min(100, pct));
    }

    private record Risk(List<String> risks, int overdueDays, Integer daysUntilDue) {
    }
}

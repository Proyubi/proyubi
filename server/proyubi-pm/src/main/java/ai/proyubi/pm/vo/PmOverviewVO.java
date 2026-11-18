package ai.proyubi.pm.vo;

import java.util.List;

/**
 * PM 俯瞰页聚合 VO（GET /app/pm/overview）。
 * 服务端一次性算好 KPI、风险一览、项目健康、近期里程碑，前端只负责渲染。
 * 风险判定规则与文档 doc/requirements/overview.md §5 对齐。
 *
 */
public record PmOverviewVO(
    /** 当前登录用户对应的 pm_member.id（未绑定为 null），供前端「担当者別」默认选中本人 */
    String meMemberId,
    Kpis kpis,
    List<RiskItem> riskItems,
    List<ProjectHealth> projectHealth,
    List<Milestone> milestones,
    /** 担当者别任务分布（全社·已分配叶子任务，按成员计数）；前端饼图用 */
    List<AssigneeCount> assigneeDistribution,
    /** 未分配叶子任务总数（与 assigneeDistribution 同口径，无日期/风险过滤）；前端饼图「未割当」片用 */
    int unassignedTaskCount,
    /** 本人担当の未完了タスク（summary 除く）。scope=me のときのみ、all は空 */
    List<MyTask> myTasks,
    /** 本人担当の未完了バグ（open/in_progress/resolved/verifying）。scope=me のときのみ、all は空 */
    List<MyBug> myBugs
) {

    /** マイタスクの一行。bucket で期日グループ分け（サーバ側で判定、前端は描画のみ） */
    public record MyTask(
        String taskId,
        String name,
        String type,
        String projectId,
        String projectName,
        String customerName,
        String start,
        String end,
        int progress,
        /** overdue（期限超過）/ today（本日期日）/ week（今週中）/ later（来週以降・期日なし） */
        String bucket,
        /** 期日までの日数：<0 超過、null=期日なし */
        Integer daysToDue,
        /** 命中リスク（evaluate と同一規則、優先度順）。無ければ空 */
        List<String> risks
    ) {
    }

    /** マイバグの一行 */
    public record MyBug(
        String id,
        String customerId,
        String customerName,
        Integer seq,
        String bugNo,
        String title,
        String severity,
        String status,
        /** 起票日 YYYY-MM-DD（未設定なら作成日） */
        String reportedOn
    ) {
    }

    /** 担当者别任务计数（一任务多担当则各 +1） */
    public record AssigneeCount(
        String memberId,
        int taskCount
    ) {
    }

    /** 顶部 KPI 信号灯 */
    public record Kpis(
        int activeProjects,
        int delayedProjects,
        int delayedTasks,
        int dueSoon,
        int unassigned,
        int blocked,
        /** 进行中任务数（叶子任务：已着手且未完成） */
        int inProgressTasks,
        /** 本周任务总数（期日落在本周一～本周日的叶子任务） */
        int weekTaskTotal,
        /** 本周已完成任务数（progress >= 100） */
        int weekTaskDone
    ) {
    }

    /** 风险一览的一行（叶子任务或里程碑） */
    public record RiskItem(
        String taskId,
        String name,
        String type,
        String projectId,
        String projectName,
        String customerId,
        String customerName,
        List<String> assigneeIds,
        String start,
        String end,
        int progress,
        /** 命中的风险种别（overdue/behind/blocked/due-soon/unassigned），按优先级排序 */
        List<String> risks,
        /** 主风险（徽标/排序用）= risks 第一个 */
        String primary,
        /** 逾期天数（overdue 时 >0；其余为 0） */
        int overdueDays,
        /** 距期日天数（due-soon 时 >=0；其余为 null） */
        Integer daysUntilDue
    ) {
    }

    /** 项目健康（按案件聚合遅延数） */
    public record ProjectHealth(
        String projectId,
        String name,
        String customerName,
        String status,
        String start,
        String end,
        int progress,
        /** 该项目的遅延任务数（overdue + behind） */
        int delay,
        /** 项目计划期已过且未交付 */
        boolean overdue
    ) {
    }

    /** 近期里程碑 */
    public record Milestone(
        String taskId,
        String name,
        String projectId,
        String projectName,
        String end,
        /** 距今天数：>=0 未到，<0 已超期 */
        int diff,
        int progress
    ) {
    }
}

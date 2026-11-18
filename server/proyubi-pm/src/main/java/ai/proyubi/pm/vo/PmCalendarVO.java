package ai.proyubi.pm.vo;

import java.util.List;

/**
 * PM 日历视图聚合 VO（GET /app/pm/calendar）。
 * 返回区间内全部叶子任务（type=task），每条带命中的风险种别（服务端评估，前端不重算），
 * 用于按天铺成月视图、回答「我今天/本周要干嘛」。规则与 doc/requirements/overview.md §5 一致。
 *
 */
public record PmCalendarVO(
    /** 当前登录用户对应的 pm_member.id（未绑定为 null），scope=me 时配合空 tasks */
    String meMemberId,
    List<CalendarTask> tasks
) {

    /** 日历上的一条已排期叶子任务 */
    public record CalendarTask(
        String taskId,
        String name,
        /** 计划开始日 YYYY-MM-DD */
        String start,
        /** 计划结束日 YYYY-MM-DD */
        String end,
        /** 0-100 */
        int progress,
        String projectId,
        String projectName,
        /** 指派成员 id 数组（member-UUID 字符串） */
        List<String> assigneeIds,
        /** 命中的风险种别（overdue/blocked/behind/due-soon/unassigned），按优先级排序，可空数组 */
        List<String> riskKinds
    ) {
    }
}

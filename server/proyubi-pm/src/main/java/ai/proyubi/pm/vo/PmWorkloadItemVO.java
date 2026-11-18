package ai.proyubi.pm.vo;

import java.util.List;

/**
 * 成员负载条目 VO（PM，跨项目）。
 * 一条 = 一个有指派的任务，带上其所属项目/客户名，供负载视图按人聚合。
 *
 */
public record PmWorkloadItemVO(
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
    String actualStart,
    String actualEnd,
    /** 予定工期（分）：予定套で算出（milestone=0）。工時実績サマリー集計用（甘特 footer と同口径）。 */
    long plannedMinutes,
    /** 実績工期（分）：着手あり（両端 or 手动d/h）で算出、未着手=0。着手中(開始のみ)の手动工期も含む。 */
    long actualMinutes
) {
}

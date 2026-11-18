package ai.proyubi.pm.vo;

import ai.proyubi.pm.domain.PmEvent;

import java.util.List;

/**
 * 事件/会议日程展示 VO。
 * <p>
 * 时间统一以 ISO 字符串输出（{@code 2026-06-14T10:00}），避免前端解 LocalDateTime 数组。
 * projectName 由 service 从 projectMap 解析后传入。
 *
 */
public record PmEventVO(
    String id,
    String title,
    String type,
    String startAt,
    String endAt,
    boolean allDay,
    String projectId,
    String projectName,
    String taskId,
    List<String> attendeeIds,
    String location,
    String note
) {
    public static PmEventVO of(PmEvent e, String projectName) {
        return new PmEventVO(
            e.getId() != null ? e.getId().toString() : null,
            e.getTitle(),
            e.getType(),
            e.getStartAt() != null ? e.getStartAt().toString() : null,
            e.getEndAt() != null ? e.getEndAt().toString() : null,
            e.getAllDay() != null && e.getAllDay(),
            e.getProjectId() != null ? e.getProjectId().toString() : null,
            projectName,
            e.getTaskId() != null ? e.getTaskId().toString() : null,
            e.getAttendeeIds() != null ? e.getAttendeeIds() : List.of(),
            e.getLocation(),
            e.getNote()
        );
    }
}

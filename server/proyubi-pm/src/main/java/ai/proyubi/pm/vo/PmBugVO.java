package ai.proyubi.pm.vo;

import ai.proyubi.pm.domain.PmBug;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * バグ票表示 VO（品質管理）。
 *
 */
public record PmBugVO(
    UUID id,
    UUID customerId,
    Integer seq,
    String bugNo,
    String title,
    String description,
    String severity,
    String priority,
    String status,
    Integer reopenCount,
    String environment,
    UUID environmentId,
    UUID assigneeMemberId,
    String assigneeName,
    UUID reporterUserId,
    String reporterName,
    UUID projectId,
    UUID taskId,
    UUID testCaseId,
    LocalDate reportedOn,
    LocalDateTime resolvedAt,
    LocalDateTime createdAt,
    LocalDateTime updatedAt
) {
    public static PmBugVO of(PmBug b) {
        return new PmBugVO(
            b.getId(),
            b.getCustomerId(),
            b.getSeq(),
            b.getBugNo(),
            b.getTitle(),
            b.getDescription(),
            b.getSeverity(),
            b.getPriority(),
            b.getStatus(),
            b.getReopenCount(),
            b.getEnvironment(),
            b.getEnvironmentId(),
            b.getAssigneeMemberId(),
            b.getAssigneeName(),
            b.getReporterUserId(),
            b.getReporterName(),
            b.getProjectId(),
            b.getTaskId(),
            b.getTestCaseId(),
            b.getReportedOn(),
            b.getResolvedAt(),
            b.getCreatedAt(),
            b.getUpdatedAt()
        );
    }
}

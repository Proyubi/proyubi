package ai.proyubi.pm.vo;

import ai.proyubi.pm.domain.PmTestSuite;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * テストスイート表示 VO（品質管理）。
 *
 */
public record PmTestSuiteVO(
    UUID id,
    UUID customerId,
    UUID taskId,
    String casePrefix,
    String name,
    String description,
    Integer sortOrder,
    LocalDateTime createdAt,
    LocalDateTime updatedAt
) {
    public static PmTestSuiteVO of(PmTestSuite s) {
        return new PmTestSuiteVO(
            s.getId(),
            s.getCustomerId(),
            s.getTaskId(),
            s.getCasePrefix(),
            s.getName(),
            s.getDescription(),
            s.getSortOrder(),
            s.getCreatedAt(),
            s.getUpdatedAt()
        );
    }
}

package ai.proyubi.pm.vo;

import ai.proyubi.pm.domain.PmTestCase;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * テストケース表示 VO（品質管理）。
 *
 */
public record PmTestCaseVO(
    UUID id,
    UUID customerId,
    UUID suiteId,
    Integer seq,
    String caseNo,
    String featureMajor,
    String featureMinor,
    String title,
    String category,
    String priority,
    String precondition,
    String steps,
    String testData,
    String expected,
    String result,
    LocalDateTime executedAt,
    UUID executedBy,
    String executedByName,
    String remark,
    Integer sortOrder,
    LocalDateTime createdAt,
    LocalDateTime updatedAt
) {
    public static PmTestCaseVO of(PmTestCase c) {
        return new PmTestCaseVO(
            c.getId(),
            c.getCustomerId(),
            c.getSuiteId(),
            c.getSeq(),
            c.getCaseNo(),
            c.getFeatureMajor(),
            c.getFeatureMinor(),
            c.getTitle(),
            c.getCategory(),
            c.getPriority(),
            c.getPrecondition(),
            c.getSteps(),
            c.getTestData(),
            c.getExpected(),
            c.getResult(),
            c.getExecutedAt(),
            c.getExecutedBy(),
            c.getExecutedByName(),
            c.getRemark(),
            c.getSortOrder(),
            c.getCreatedAt(),
            c.getUpdatedAt()
        );
    }
}

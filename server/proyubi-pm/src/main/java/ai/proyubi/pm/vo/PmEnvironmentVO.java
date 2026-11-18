package ai.proyubi.pm.vo;

import ai.proyubi.pm.domain.PmEnvironment;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 環境マスタ表示 VO（品質管理）。label は name/browser/url の合成表示。
 *
 */
public record PmEnvironmentVO(
    UUID id,
    UUID customerId,
    String name,
    String browser,
    String url,
    /** 表示ラベル（name [/ browser] [(url)]） */
    String label,
    Integer sortOrder,
    LocalDateTime createdAt,
    LocalDateTime updatedAt
) {
    public static PmEnvironmentVO of(PmEnvironment e) {
        return new PmEnvironmentVO(
            e.getId(),
            e.getCustomerId(),
            e.getName(),
            e.getBrowser(),
            e.getUrl(),
            e.composeLabel(),
            e.getSortOrder(),
            e.getCreatedAt(),
            e.getUpdatedAt()
        );
    }
}

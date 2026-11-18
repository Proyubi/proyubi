package ai.proyubi.pm.vo;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 設計審査コメント VO。mine = 呼び出し者本人の投稿（編集・削除ボタンの表示判定用。権限はサーバで再判定）。
 *
 */
public record PmDesignCommentVO(
    UUID id,
    UUID designId,
    Integer revision,
    String elementId,
    Double anchorX,
    Double anchorY,
    String body,
    boolean resolved,
    String resolvedByName,
    LocalDateTime resolvedAt,
    UUID authorUserId,
    String authorName,
    String via,
    boolean mine,
    LocalDateTime createdAt,
    LocalDateTime updatedAt
) {
}

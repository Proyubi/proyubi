package ai.proyubi.pm.vo;

import ai.proyubi.pm.domain.PmComment;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 任务评论展示 VO。在实体字段之上附带 {@code mine}（是否当前登录用户本人发的），
 * 由服务端按 authorUserId 判定，前端据此决定是否显示「编辑/删除」入口，避免前端猜测身份。
 *
 */
public record PmCommentVO(
    UUID id,
    UUID taskId,
    UUID authorUserId,
    UUID authorMemberId,
    String authorName,
    String content,
    LocalDateTime createdAt,
    LocalDateTime updatedAt,
    boolean mine
) {
    public static PmCommentVO of(PmComment c, UUID currentUserId) {
        return new PmCommentVO(
            c.getId(),
            c.getTaskId(),
            c.getAuthorUserId(),
            c.getAuthorMemberId(),
            c.getAuthorName(),
            c.getContent(),
            c.getCreatedAt(),
            c.getUpdatedAt(),
            currentUserId != null && currentUserId.equals(c.getAuthorUserId())
        );
    }
}

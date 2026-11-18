package ai.proyubi.pm.vo;

import ai.proyubi.pm.domain.PmTaskLink;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 任务关联链接展示 VO。
 * 链接是任务共享上下文（非个人留言），不带 {@code mine}：任意本租户成员均可删除。
 *
 */
public record PmTaskLinkVO(
    UUID id,
    UUID taskId,
    String kind,
    String url,
    String title,
    UUID createdBy,
    LocalDateTime createdAt
) {
    public static PmTaskLinkVO of(PmTaskLink l) {
        return new PmTaskLinkVO(
            l.getId(),
            l.getTaskId(),
            l.getKind(),
            l.getUrl(),
            l.getTitle(),
            l.getCreatedBy(),
            l.getCreatedAt()
        );
    }
}

package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 任务评论实体（PM）。一条评论挂在某个 pm_task 上，构成该任务的留言/讨论流。
 *
 */
@Data
@Table("pm_comment")
public class PmComment {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属任务（pm_task.id） */
    private UUID taskId;

    /** 发帖人对应的租户用户（platform_tenant_user.id）；编辑/删除鉴权的权威字段 */
    private UUID authorUserId;

    /** 发帖人对应的 PM 成员（pm_member.id）；用于头像底色，未绑定成员时为 null */
    private UUID authorMemberId;

    /** 发帖人显示名快照（发帖时定格，成员改名/删除后仍可正确展示） */
    private String authorName;

    /** 评论正文（纯文本，保留换行） */
    private String content;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 任务关联链接实体（PM）。一条链接挂在某个 pm_task 上，指向外部资料——首版主打 Figma 设计稿，
 * kind=figma 时前端用 iframe 内联预览；其余仅渲染为可点链接卡片。
 * 设计稿等是任务的共享上下文（非个人留言），删除允许任意本租户成员操作；createdBy 仅作审计。
 *
 */
@Data
@Table("pm_task_link")
public class PmTaskLink {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属任务（pm_task.id） */
    private UUID taskId;

    /** 链接种别：figma / link / image；后端按 url 域名判定，前端据此决定渲染方式 */
    private String kind;

    /** 链接 URL（http/https） */
    private String url;

    /** 用户备注名（可空；空则前端显示域名） */
    private String title;

    /** 添加人对应的租户用户（platform_tenant_user.id）；仅作审计 */
    private UUID createdBy;

    private LocalDateTime createdAt;

    private LocalDateTime deletedAt;
}

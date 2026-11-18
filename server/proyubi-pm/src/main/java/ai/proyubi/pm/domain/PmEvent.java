package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import ai.proyubi.common.mybatisflex.typehandler.PostgreSqlStringArrayTypeHandler;
import lombok.Data;
import org.apache.ibatis.type.JdbcType;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 事件/会议日程实体（PM · 迭代二）。
 * <p>
 * 独立于 {@link PmTask}：事件不进 WBS 树、不参与 TaskRollupService / 进度汇总，
 * 仅嵌入 /calendar 月历按类型色展示。project_id 为 null 即「全局事件」（本租户全员可见），
 * 非空则按团队可见性过滤；task_id 仅作跳转线索。
 *
 */
@Data
@Table("pm_event")
public class PmEvent {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 可挂项目（团队可见性维度）；null=全局事件，本租户全员可见 */
    private UUID projectId;

    /** 可选关联任务（仅跳转线索，不参与任何 rollup） */
    private UUID taskId;

    /** 标题 */
    private String title;

    /** 事件种别：meeting / review / milestone / deadline / other */
    private String type;

    /** 开始时刻（all_day=true 时取当天 00:00 起） */
    private LocalDateTime startAt;

    /** 结束时刻（可空，单点事件） */
    private LocalDateTime endAt;

    /** 是否全天 */
    private Boolean allDay;

    /** 参加者 pm_member id 字符串数组（复用 PostgreSqlStringArrayTypeHandler） */
    @Column(typeHandler = PostgreSqlStringArrayTypeHandler.class, jdbcType = JdbcType.ARRAY)
    private List<String> attendeeIds;

    /** 场所（可空） */
    private String location;

    /** 备注（可空） */
    private String note;

    /** 创建人租户用户 id（platform_tenant_user.id）；审计用，删除不限本人 */
    private UUID createdBy;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

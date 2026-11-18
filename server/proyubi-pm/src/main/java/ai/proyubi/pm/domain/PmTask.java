package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import ai.proyubi.common.mybatisflex.typehandler.PostgreSqlStringArrayTypeHandler;
import lombok.Data;
import org.apache.ibatis.type.JdbcType;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 任务实体（PM / WBS 树）。
 * parent_id 为 null 即根任务；type=summary 的起止/进度由叶子按工期加权汇总（见 TaskRollupService）。
 *
 */
@Data
@Table("pm_task")
public class PmTask {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属项目ID */
    private UUID projectId;

    /** 父任务ID（根任务为 null，构成树） */
    private UUID parentId;

    /** 任务名 */
    private String name;

    /** 计划开始日（纯日期，闭区间；milestone 时 start === end） */
    @Column("start_date")
    private LocalDate start;

    /** 计划结束日（纯日期，闭区间含尾日） */
    @Column("end_date")
    private LocalDate end;

    /** 实际开始日（可空） */
    @Column("actual_start")
    private LocalDate actualStart;

    /** 实际结束日（可空） */
    @Column("actual_end")
    private LocalDate actualEnd;

    /**
     * 仅汇总产物（不持久化）：summary 实绩「进行中」（已开始但未全部叶子完成），
     * 此时 actualEnd 不确定，前端把实际条画到「今天」并以未闭合样式呈现。
     * 由 {@link ai.proyubi.pm.service.TaskRollupService} 计算，与前端 tree.ts 同口径。
     */
    @Column(ignore = true)
    private Boolean actualOngoing;

    /**
     * 予定工期·最終日の作業時間（手填小时，0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天）。
     * 配合「予定期間」(start/end)：工期 =「工作日天数 D + 本字段」，H>0 时=(D−1)天+H小时
     * （见 TaskRollupService.effortMinutes）。仅叶子（通常タスク）有意义；summary/milestone 不用。
     */
    @Column("planned_effort_hours")
    private Double plannedEffortHours;

    /**
     * 実績工期·最終日の作業時間（手填小时，0–23.75，可小数 0.25 刻み；空/0=最后一天也算整天）。
     * 配合「実績期間」(actualStart/actualEnd)：仅当实绩两端齐全时参与工期计算，口径同上。
     */
    @Column("actual_effort_hours")
    private Double actualEffortHours;

    /**
     * 予定工期·日数（手动，工期日历日数 1d=24h 日历日）。与同套 plannedEffortHours 组成手动 d/h；
     * null=未手动设置（该套回退按予定期间派生 effortMinutes）。工期=days*24h*60 + planned_effort_hours*60（分钟）。
     * 仅叶子（通常タスク）有意义；summary/milestone 不用。
     */
    @Column("planned_effort_days")
    private Integer plannedEffortDays;

    /**
     * 実績工期·日数（手动，1d=24h 日历日）。与同套 actualEffortHours 组成手动 d/h；
     * null=未手动设置（该套回退按实绩期间派生）。配合 actual_effort_hours，両端齐全才参与。
     */
    @Column("actual_effort_days")
    private Integer actualEffortDays;

    /** 0-100：叶子为权威值；summary 由子节点按工期加权汇总 */
    private Integer progress;

    /** 指派成员 id 数组（首版"一天一项目"，指派直接挂叶子任务上） */
    @Column(typeHandler = PostgreSqlStringArrayTypeHandler.class, jdbcType = JdbcType.ARRAY)
    private List<String> assigneeIds;

    /** レベル：自由标签数组（一个任务可多个） */
    @Column(typeHandler = PostgreSqlStringArrayTypeHandler.class, jdbcType = JdbcType.ARRAY)
    private List<String> levels;

    /** 任务描述（富文本 HTML，可含 img 贴图） */
    private String description;

    /** 类型：task / summary / milestone */
    private String type;

    /** 是否折叠子节点（仅 summary 有意义） */
    private Boolean collapsed;

    /** 是否在路线图展示（仅 summary/milestone 有意义） */
    private Boolean roadmapVisible;

    /** 路线图泳道：milestone/system/business（null=默认） */
    private String roadmapLane;

    /** 责任方：client=貴社 / vendor=弊社（null=不区分） */
    private String ownerParty;

    /** 里程碑语义色：critical/normal/client/vendor（仅 milestone 用） */
    private String milestoneColor;

    /** 看板状态：backlog/todo/in_progress/testing/done/cancelled（业务状态，独立于 progress） */
    private String status;

    /** 同级排序 */
    @Column("sort_order")
    private Integer order;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

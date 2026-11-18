package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 路线图可自定义字典实体（PM）。
 * 把原先写死在前端的「泳道(lane)」「里程碑色(ms_color)」改为租户可自定义。
 * pm_task.roadmap_lane / milestone_color 引用本表的 option_key（保留旧枚举值，零数据迁移）。
 *
 */
@Data
@Table("pm_roadmap_option")
public class PmRoadmapOption {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 项目级覆盖（null=租户级全局；首版只写 null，预留项目级扩展） */
    private UUID projectId;

    /** 用途：lane=泳道 / ms_color=里程碑色 */
    private String kind;

    /** 稳定 key，pm_task 引用此值；系统种子沿用旧枚举值（milestone/system/business/critical/...） */
    private String optionKey;

    /** 显示名（日文优先） */
    private String label;

    /** 阶段条 / 里程碑菱形颜色（#RRGGBB）；milestone 泳道可空 */
    private String color;

    /** 排序（升序，越小越靠前；取代写死的 LANE_ORDER） */
    @Column("sort_order")
    private Integer sortOrder;

    /** 系统内置项（不可删，可改色/名/排序） */
    private Boolean isSystem;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 任务依赖实体（PM）。首版仅 Finish-to-Start：前序完成→后续开始。
 *
 */
@Data
@Table("pm_dependency")
public class PmDependency {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属项目ID */
    private UUID projectId;

    /** 前序任务 */
    private UUID predecessorId;

    /** 后续任务 */
    private UUID successorId;

    /** 依赖类型（首版仅 FS） */
    private String type;

    /**
     * 延迟，可选。当前多为 null、不参与排程。
     * TODO(v1 未定单位)：任务工期已细化到小时（datetime 模型），lag 单位待明确（天/分钟）；v1 暂不改逻辑。
     */
    private Integer lag;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

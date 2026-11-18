package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 画框 ⇄ タスクの紐付け（同じ案件のタスクのみ）。
 *
 */
@Data
@Table("pm_design_frame_task")
public class PmDesignFrameTask {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    private UUID designId;

    private String nodeId;

    private UUID taskId;

    private UUID createdBy;

    private String createdByName;

    private LocalDateTime createdAt;
}

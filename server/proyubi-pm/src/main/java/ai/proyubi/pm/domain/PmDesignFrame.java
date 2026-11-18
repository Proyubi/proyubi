package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * .pen の画框（最上位フレーム）。審査ステータスとタスク紐付けの単位。
 * 行は .pen の保存ごとに原文から同期し、最新修訂に無い画框は removed = true で残す。
 *
 */
@Data
@Table("pm_design_frame")
public class PmDesignFrame {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    private UUID designId;

    /** .pen 内のノード id */
    private String nodeId;

    private String name;

    /** 原文の並び順 */
    private Integer sortOrder;

    /** draft / review / changes / approved */
    private String reviewStatus;

    private UUID statusBy;

    private String statusByName;

    private LocalDateTime statusAt;

    /** この画框が存在した最後の修訂番号 */
    private Integer lastRevision;

    /** 最新修訂に存在しない */
    private Boolean removed;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}

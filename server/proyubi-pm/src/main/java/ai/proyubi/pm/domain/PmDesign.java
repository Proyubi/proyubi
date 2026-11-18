package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 設計資産（PM Design Studio）。Excalidraw 白板 / OpenPencil .pen 原稿の不変の身元。
 * 内容は {@link PmDesignRevision} に不可変の修訂として持ち、current_revision は DB の CAS でのみ進める
 * （{@link ai.proyubi.pm.mapper.PmDesignMapper#advanceRevision}）。
 * 設計：work/design-studio/requirements.md §4–§5
 *
 */
@Data
@Table("pm_design")
public class PmDesign {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属案件（必須） */
    private UUID projectId;

    /** 紐付けタスク（可空。同じ案件のタスクのみ） */
    private UUID taskId;

    private String title;

    /** excalidraw / pen */
    private String format;

    /** 最新修訂番号（1 始まり） */
    private Integer currentRevision;

    /** Git 由来メタ（手動導入時のみ。トークンは保存しない） */
    private String sourceRepo;

    private String sourceRef;

    private String sourcePath;

    private String sourceCommitSha;

    /** 最後に取り込んだ / 書き出した源ファイルの SHA-256 */
    private String sourceHash;

    /** 作成者の租户ユーザ（platform_tenant_user.id） */
    private UUID createdBy;

    private String createdByName;

    private UUID updatedBy;

    private String updatedByName;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

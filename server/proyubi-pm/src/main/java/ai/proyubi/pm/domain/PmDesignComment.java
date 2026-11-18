package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 設計の審査コメント。修訂に紐付く（版レベル）。element_id / anchor は予約（節点定位は後続）。
 * タスクコメント（pm_comment）とは別物として保存する。
 *
 */
@Data
@Table("pm_design_comment")
public class PmDesignComment {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    private UUID designId;

    /** 対象修訂番号 */
    private Integer revision;

    /** 対象要素 id（可空、後続の節点定位用） */
    private String elementId;

    private Double anchorX;

    private Double anchorY;

    /** 本文（プレーンテキスト） */
    private String body;

    private Boolean resolved;

    private UUID resolvedBy;

    private String resolvedByName;

    private LocalDateTime resolvedAt;

    /** 投稿者の租户ユーザ（platform_tenant_user.id） */
    private UUID authorUserId;

    /** 投稿者表示名スナップショット */
    private String authorName;

    /** web / mcp */
    private String via;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

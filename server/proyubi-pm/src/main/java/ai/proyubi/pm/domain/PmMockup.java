package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * モックアップ実体（PM）。Claude Code / Codex で作った単一 HTML の効果図。
 * 版をまたいで不変の身元で、HTML 原文は {@link PmMockupVersion} に版ごとに持つ。
 * 案件 / タスク / バグに紐付け、共有リンク（share_*）で社外にも見せられる。
 * 設計：doc/design/pm-mockup.md
 *
 */
@Data
@Table("pm_mockup")
public class PmMockup {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属顧客（案件 / タスク / バグからサーバ側で導出） */
    private UUID customerId;

    /** 所属案件；null = 案件に紐付かないバグのモックアップ */
    private UUID projectId;

    /** 紐付けタスク（可空） */
    private UUID taskId;

    /** 紐付けバグ（可空） */
    private UUID bugId;

    private String title;

    /** 最新の未削除版番号 */
    private Integer currentVersion;

    /** 共有リンクの推測不能トークン；未発行は null */
    private String shareToken;

    private Boolean shareEnabled;

    /** 共有期限；null = 無期限 */
    private LocalDateTime shareExpiresAt;

    /** 共有で見せる版を固定；null = 常に最新版 */
    private Integer sharePinnedVersion;

    private Integer shareViewCount;

    private LocalDateTime shareLastViewedAt;

    /** 作成者の租户ユーザ（platform_tenant_user.id） */
    private UUID createdBy;

    /** 作成者表示名スナップショット */
    private String createdByName;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

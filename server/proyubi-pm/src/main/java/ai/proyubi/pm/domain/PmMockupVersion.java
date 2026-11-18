package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * モックアップの版（PM）。入口 HTML の原文をそのまま content に保持する。
 * zip 公開の版は入口以外のファイルを {@link PmMockupFile} に持つ。
 * 一覧系のクエリでは content を読まないこと（{@link ai.proyubi.pm.mapper.PmMockupVersionMapper#META_COLUMNS}）。
 *
 */
@Data
@Table("pm_mockup_version")
public class PmMockupVersion {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    private UUID mockupId;

    /** 版番号（1 始まり、モックアップ内で一意） */
    private Integer version;

    /** 入口 HTML 原文（UTF-8、改変しない） */
    private String content;

    /** 入口 HTML のパス（例 index.html）。null = 旧データ（index.html 扱い） */
    private String entryPath;

    /** ファイル数（入口 HTML を含む）。単一 HTML = 1 */
    private Integer fileCount;

    /** 全ファイルの合計バイト数 */
    private Integer sizeBytes;

    /** 内容の SHA-256（hex）。zip は全ファイルのパス + ハッシュ一覧から計算 */
    private String sha256;

    /** 版の変更メモ（可空） */
    private String note;

    /** 公開経路：web / mcp */
    private String via;

    /** 公開者の租户ユーザ（platform_tenant_user.id） */
    private UUID createdBy;

    /** 公開者表示名スナップショット */
    private String createdByName;

    private LocalDateTime createdAt;

    private LocalDateTime deletedAt;
}

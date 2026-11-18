package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 設計資産の不可変修訂。一度書いたら更新・削除しない（修訂番号は再利用しない）。
 * 一覧系のクエリでは content を読まないこと（{@link ai.proyubi.pm.mapper.PmDesignRevisionMapper#META_COLUMNS}）。
 *
 */
@Data
@Table("pm_design_revision")
public class PmDesignRevision {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    private UUID designId;

    /** 修訂番号（設計内で一意、1 始まり） */
    private Integer revision;

    /** excalidraw = サーバで検証・整形した場面 JSON；pen = 原文バイトの base64 */
    private String content;

    /** json / base64 */
    private String encoding;

    /** 原文のバイト数（base64 は復号後） */
    private Integer sizeBytes;

    /** 原文バイトの SHA-256（hex） */
    private String sha256;

    /** 導入時の元ファイル名（可空） */
    private String fileName;

    private String note;

    /** web / mcp */
    private String via;

    private UUID createdBy;

    private String createdByName;

    private LocalDateTime createdAt;
}

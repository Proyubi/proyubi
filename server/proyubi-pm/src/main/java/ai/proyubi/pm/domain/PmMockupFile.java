package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * モックアップ版の付属ファイル（PM）。zip 公開時の入口 HTML 以外（画像・CSS・JS・他の HTML など）。
 * 設計：doc/design/pm-mockup.md §7
 *
 */
@Data
@Table("pm_mockup_file")
public class PmMockupFile {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    private UUID versionId;

    /** 版ルートからの相対パス（/ 区切り、NFC 正規化済み） */
    private String path;

    /** 拡張子から決めた Content-Type */
    private String contentType;

    private Integer sizeBytes;

    /** ファイル本体 */
    private byte[] data;

    private LocalDateTime createdAt;
}

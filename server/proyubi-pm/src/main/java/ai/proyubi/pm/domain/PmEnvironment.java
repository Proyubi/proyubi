package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 環境マスタ（品質管理）。バグ票の動作環境（区分・ブラウザ/端末・URL）を製品(pm_customer)配下に持つ。
 * 表示は name [/ browser] [(url)] に自動合成（例：dev / Chrome (https://dev.example.com)）。
 * 可視性・チームは customer 経由で継承する（pm_test_suite と同一慣習、本テーブルは team_id を持たない）。
 *
 */
@Data
@Table("pm_environment")
public class PmEnvironment {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属顧客/製品（pm_customer.id）；可視性・team はこの customer から継承 */
    private UUID customerId;

    /** 区分ラベル（例：dev / staging / prod）。表示合成の先頭 */
    private String name;

    /** 端末/ブラウザ（例：Chrome / iOS Safari）。任意 */
    private String browser;

    /** 対象URL（例：https://dev.example.com）。任意 */
    private String url;

    /** 表示順（昇順） */
    private Integer sortOrder;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;

    /**
     * 表示ラベルを合成する：name [/ browser] [(url)]。
     * バグ票の environment スナップショット文字列に用いる。
     */
    public String composeLabel() {
        StringBuilder sb = new StringBuilder(name != null ? name : "");
        if (browser != null && !browser.isBlank()) {
            sb.append(" / ").append(browser.trim());
        }
        if (url != null && !url.isBlank()) {
            sb.append(" (").append(url.trim()).append(")");
        }
        return sb.toString();
    }
}

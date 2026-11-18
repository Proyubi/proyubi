package ai.proyubi.pm.vo;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * モックアップ展示 VO。紐付け先の名前（案件 / タスク / バグ）は表示用に解決済み。
 * {@code versions} は詳細取得時のみ（一覧では null → 省略）。
 *
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PmMockupVO(
    UUID id,
    UUID customerId,
    UUID projectId,
    String projectName,
    UUID taskId,
    String taskName,
    UUID bugId,
    String bugNo,
    String bugTitle,
    String title,
    Integer currentVersion,
    /** 最新版のバイト数（zip は全ファイル合計） */
    Integer sizeBytes,
    /** 最新版のファイル数（単一 HTML = 1） */
    Integer fileCount,
    /** 最新版の公開日時 / 公開者 / 経路（web|mcp） */
    LocalDateTime updatedAt,
    String updatedByName,
    String lastVia,
    UUID createdBy,
    String createdByName,
    LocalDateTime createdAt,
    Share share,
    List<Version> versions
) {

    /** 共有リンクの状態。token は未発行なら null。 */
    public record Share(
        boolean enabled,
        String token,
        LocalDateTime expiresAt,
        Integer pinnedVersion,
        int viewCount,
        LocalDateTime lastViewedAt
    ) {
    }

    public record Version(
        Integer version,
        String note,
        Integer sizeBytes,
        Integer fileCount,
        String via,
        String createdByName,
        LocalDateTime createdAt
    ) {
    }

    /** 公開共有ページ用（ログイン不要）。社内情報は顧客名・案件名・タイトル・版だけに絞る。 */
    public record PublicShare(
        String title,
        String customerName,
        String projectName,
        Integer version,
        LocalDateTime updatedAt,
        LocalDateTime expiresAt,
        String viewUrl
    ) {
    }

    /** 署名付き原文 URL */
    public record ViewUrl(String url, LocalDateTime expiresAt) {
    }
}

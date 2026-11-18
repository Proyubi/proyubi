package ai.proyubi.pm.vo;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 設計資産 VO。{@code content} / {@code revisions} は詳細取得時のみ（一覧では null → 省略）。
 * content は表示中の修訂の原文：excalidraw = 場面 JSON 文字列、pen = 原文バイトの base64（encoding で判別）。
 *
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PmDesignVO(
    UUID id,
    UUID projectId,
    String projectName,
    UUID taskId,
    String taskName,
    String title,
    /** excalidraw / pen */
    String format,
    Integer currentRevision,
    Source source,
    UUID createdBy,
    String createdByName,
    LocalDateTime createdAt,
    String updatedByName,
    LocalDateTime updatedAt,
    /** 詳細時：表示中の修訂のメタと原文 */
    Revision revision,
    String content,
    List<Revision> revisions
) {

    /** Git 由来メタ（手動導入 / 書き出し時に記録。トークンは含まない） */
    public record Source(String repo, String ref, String path, String commitSha, String hash) {
    }

    /** 修訂メタ（原文なし） */
    public record Revision(Integer revision, String encoding, Integer sizeBytes, String sha256,
                           String fileName, String note, String via, String createdByName,
                           LocalDateTime createdAt) {
    }
}

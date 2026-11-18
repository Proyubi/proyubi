package ai.proyubi.pm.vo;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * .pen 画框 VO。tasks = 紐付けタスク（削除済み・不可視は除く）、openComments = 未解決の画框コメント数。
 * designId / designTitle はタスク側から引いたとき（{@code /frames?taskId=}）に使う。
 *
 */
public record PmDesignFrameVO(
    UUID designId,
    String designTitle,
    String nodeId,
    String name,
    Integer sortOrder,
    String reviewStatus,
    String statusByName,
    LocalDateTime statusAt,
    Integer lastRevision,
    boolean removed,
    List<TaskRef> tasks,
    int openComments
) {

    public record TaskRef(UUID taskId, String name, String status) {
    }
}

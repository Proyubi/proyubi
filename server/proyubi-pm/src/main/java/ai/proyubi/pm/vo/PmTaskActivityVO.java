package ai.proyubi.pm.vo;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * タスク操作履歴の表示用 VO。
 * <p>
 * {@code changes} は JSON 文字列のまま返さず配列に展開して渡す（フロントで再パースさせない）。
 * 値はコード（status/type など）か表示名スナップショット（担当者・親タスクなど）で、
 * ラベル化・整形はロケールを持つフロント側の責務。
 *
 */
public record PmTaskActivityVO(
    UUID id,
    UUID taskId,
    UUID actorMemberId,
    String actorName,
    /** created / updated / child_added / child_removed / dep_added / dep_removed */
    String action,
    /** web(画面) / mcp(内部API・自動連携) */
    String source,
    LocalDateTime createdAt,
    List<Change> changes
) {

    /**
     * 差分1件。単値フィールドは {@code from}/{@code to}、
     * 集合フィールド（担当者・ラベル・サブタスク・依存）は {@code added}/{@code removed} を使う。
     */
    public record Change(
        /** name / type / status / progress / planRange / actualRange / plannedEffort / actualEffort /
         *  assignees / levels / description / parent / project / roadmapVisible / roadmapLane /
         *  ownerParty / milestoneColor / subtask / predecessor / successor */
        String field,
        String from,
        String to,
        List<String> added,
        List<String> removed
    ) {
        public static Change of(String field, String from, String to) {
            return new Change(field, from, to, null, null);
        }

        public static Change ofSet(String field, List<String> added, List<String> removed) {
            return new Change(field, null, null, added, removed);
        }
    }
}

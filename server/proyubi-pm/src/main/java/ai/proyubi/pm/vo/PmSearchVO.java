package ai.proyubi.pm.vo;

import java.util.List;

/**
 * PM 横断検索 VO（GET /app/pm/search）。
 * <p>
 * 前端コマンドパレット（⌘K）用。案件を跨いでタスク / 案件 / バグ票を 1 リクエストで引く。
 * 「どのグループに出たか」でヒット理由が分かるよう、マッチ対象はグループごとに固定する：
 * <ul>
 *   <li>{@link TaskHit}    … pm_task.name のみ</li>
 *   <li>{@link ProjectHit} … pm_project.name / 紐づく顧客名</li>
 *   <li>{@link BugHit}     … pm_bug.title / bug_no</li>
 * </ul>
 * 日付は前端 {@code normalizeTask} と揃えて "YYYY-MM-DD" 文字列で返す。
 *
 */
public record PmSearchVO(
    List<TaskHit> tasks,
    List<ProjectHit> projects,
    List<BugHit> bugs
) {

    /** 空結果（キーワード未指定 / 可視データなし）。 */
    public static PmSearchVO empty() {
        return new PmSearchVO(List.of(), List.of(), List.of());
    }

    /** タスクのヒット 1 件。パレットの行がそのまま描けるだけの情報を持つ。 */
    public record TaskHit(
        String id,
        String name,
        /** pm_task.type（"milestone" ならパレットでも菱形表示） */
        String type,
        String projectId,
        String projectName,
        String customerId,
        String customerName,
        List<String> assigneeIds,
        /** YYYY-MM-DD / 未設定は null */
        String start,
        /** YYYY-MM-DD / 未設定は null */
        String end,
        int progress,
        /** 期限超過日数（end < today かつ未完了のときのみ >0） */
        int overdueDays
    ) {
    }

    /** 案件のヒット 1 件。 */
    public record ProjectHit(
        String id,
        String name,
        String customerId,
        String customerName,
        String status,
        String start,
        String end,
        int progress,
        /** 未完了タスク数（pm_project.open_task_count のキャッシュ値。未集計は 0） */
        int openTaskCount
    ) {
    }

    /** バグ票のヒット 1 件。 */
    public record BugHit(
        String id,
        String bugNo,
        String title,
        String status,
        String severity,
        String customerId,
        String customerName,
        String projectId,
        String projectName,
        String assigneeName,
        /** YYYY-MM-DD / 未設定は null */
        String reportedOn
    ) {
    }
}

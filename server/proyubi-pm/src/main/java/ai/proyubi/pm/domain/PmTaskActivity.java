package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import ai.proyubi.common.mybatisflex.typehandler.PostgreSqlJsonbTypeHandler;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * タスク操作履歴（追記専用）。
 * <p>
 * 1回の保存＝1行。同時に変わった複数フィールドは {@code changes} の JSON 配列に畳み込み、
 * 「保存を押した回数」と履歴の件数を一致させる（フィールドごとに1行にすると
 * 一括編集のたびに履歴が水増しされ、経緯が読めなくなるため）。
 * 追記専用なので更新も論理削除も行わない（{@code updated_at} / {@code deleted_at} を持たない）。
 *
 */
@Data
@Table("pm_task_activity")
public class PmTaskActivity {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 対象タスク */
    private UUID taskId;

    /** 対象タスクの所属プロジェクト（記録時点のスナップショット；跨项目移动の追跡用） */
    private UUID projectId;

    /** 操作者の租户ユーザ id（内部 API 経由で不明なら null） */
    private UUID actorUserId;

    /** 操作者の PM メンバー id（アバター色用；未紐付けなら null） */
    private UUID actorMemberId;

    /** 操作者表示名スナップショット（メンバー改名/削除後も履歴が読めるよう記録時に定格） */
    private String actorName;

    /** created / updated / child_added / child_removed / dep_added / dep_removed */
    private String action;

    /** 差分配列 JSON：{@code [{field, from, to, added[], removed[]}]}（jsonb） */
    @Column(typeHandler = PostgreSqlJsonbTypeHandler.class)
    private String changes;

    /** 操作元：web(画面) / mcp(内部API・自動連携) */
    private String source;

    private LocalDateTime createdAt;
}

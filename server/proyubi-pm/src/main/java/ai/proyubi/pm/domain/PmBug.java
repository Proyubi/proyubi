package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * バグ票（品質管理）。失敗ケースからの起票 or 単独起票。
 * task_id 単一 FK でタスク紐付け、test_case_id で発生ケースへ双方向トレース。
 * status/severity/priority は軽量セット（JIRA 風 resolution 分離は将来）。
 *
 */
@Data
@Table("pm_bug")
public class PmBug {

    @Id
    private UUID id;

    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属顧客/製品（pm_customer.id）；可視性・team は customer から継承 */
    private UUID customerId;

    /** 顧客内連番（欠番非再利用）。表示IDは bug_no。 */
    private Integer seq;

    /** 表示ID（例：BUG-001）。'BUG-' + lpad(seq,3） */
    private String bugNo;

    /** タイトル */
    private String title;

    /** 内容（再現手順/期待/実際） */
    private String description;

    /** 影響度：high / medium / low */
    private String severity;

    /** 優先度：high / medium / low（severity と独立軸） */
    private String priority;

    /** 状態：open / in_progress / resolved / verifying / closed / wontfix */
    private String status;

    /** 再オープン回数（→in_progress アクションで +1） */
    private Integer reopenCount;

    /** 環境（表示スナップショット；environment マスタ選択時は合成ラベルをコピー、旧・自由入力も保持） */
    private String environment;

    /** 環境マスタ参照（pm_environment.id；null=未選択 or 旧・自由入力） */
    private UUID environmentId;

    /** 担当 pm_member.id */
    private UUID assigneeMemberId;

    /** 担当者名スナップショット */
    private String assigneeName;

    /** 報告者（platform_tenant_user.id） */
    private UUID reporterUserId;

    /** 報告者名スナップショット */
    private String reporterName;

    /** 任意紐付けプロジェクト/版本（pm_project.id；null=製品全体）。製品(customerId)配下に限定 */
    private UUID projectId;

    /** ★タスク紐付け（pm_task.id；null=未紐付け） */
    private UUID taskId;

    /** 発生元ケース（pm_test_case.id；単独起票時 null） */
    private UUID testCaseId;

    /** 起票日（業務上の起票日、日付のみ）。createdAt（システム作成時刻）とは独立 */
    private LocalDate reportedOn;

    /** resolved/closed 遷移時にスタンプ */
    private LocalDateTime resolvedAt;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

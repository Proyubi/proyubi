package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * テストケース（品質管理）。= Excel の1行。仕様フィールド + 最新実施結果を行に保持
 * （latest-result-on-row。実行履歴の子テーブルは v1 では持たない）。
 * task_id で pm_task へ紐付け可能（単一 nullable FK、pm_task_link 流儀）。
 *
 */
@Data
@Table("pm_test_case")
public class PmTestCase {

    @Id
    private UUID id;

    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属顧客/製品（pm_customer.id）；suite から非正規化コピー。一覧フィルタ/可視性を単表で完結 */
    private UUID customerId;

    /** 所属スイート（pm_test_suite.id） */
    private UUID suiteId;

    /** スイート内連番（欠番非再利用）。表示IDは case_no。 */
    private Integer seq;

    /** 表示ID（例：STU-001）。取込時は Excel の No. をそのまま、手動時は prefix+lpad(seq,3) */
    private String caseNo;

    /** 大機能 */
    private String featureMajor;

    /** 中機能/画面 */
    private String featureMinor;

    /** テスト観点/項目 */
    private String title;

    /** 区分：normal(正常系) / abnormal(異常系) / boundary(境界値) */
    private String category;

    /** 優先度：high / medium / low */
    private String priority;

    /** 前提条件 */
    private String precondition;

    /** テスト手順（複数行 \n 保持） */
    private String steps;

    /** テストデータ */
    private String testData;

    /** 期待結果 */
    private String expected;

    /** 実施結果：null=未実施 / pass=OK / fail=NG / na=対象外 */
    private String result;

    /** 実施日（result 変更時に自動スタンプ、任意で上書き可） */
    private LocalDateTime executedAt;

    /** 担当者（platform_tenant_user.id；result 変更時に current user を自動セット） */
    private UUID executedBy;

    /** 担当者名スナップショット（改名/削除後も表示可） */
    private String executedByName;

    /** 備考 */
    private String remark;

    /** スイート内表示順 */
    private Integer sortOrder;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

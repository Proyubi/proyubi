package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * テストスイート（品質管理）。= Excel の1シート（例：01-学生管理）。テストケースのグルーピング単位。
 * バージョン(pm_project)配下に置き、可視性・チームは project 経由で継承する（pm_task と同一慣習、
 * 本テーブルには team_id を持たない）。
 *
 */
@Data
@Table("pm_test_suite")
public class PmTestSuite {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属顧客/製品（pm_customer.id）；可視性・team はこの customer から継承 */
    private UUID customerId;

    /** スイート⇄タスク任意紐付け（pm_task.id；null=未紐付け）。版本を跨ぐスイートを特定タスクへ関連付け */
    private UUID taskId;

    /** 採番接頭辞（大機能コード、例 STU/MST）。手動採番時 case_no = prefix + '-' + lpad(seq,3) */
    private String casePrefix;

    /** スイート名（例：01-学生管理） */
    private String name;

    /** 説明（任意） */
    private String description;

    /** シート表示順（00,01,02…；昇順） */
    private Integer sortOrder;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 项目/版本实体（PM）。例：v1.4.0
 *
 */
@Data
@Table("pm_project")
public class PmProject {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属客户/产品ID */
    private UUID customerId;

    /** 所属团队ID（多团队隔离；从所属客户继承，customer 变更时同步） */
    private UUID teamId;

    /** 项目/版本名 */
    private String name;

    private String description;

    /** 状态：planned / active / done / paused */
    private String status;

    /**
     * 项目种别：project=通常项目（固定范围，进度=任务加权汇总）/ ops=运维保守（范围滚动，按件数看）。
     * ops 型允许 {@link #end} 为 null（＝継続中），且列表页不显示进度条。
     */
    private String kind;

    /** 计划开始日（ISO date） */
    @Column("start_date")
    private LocalDate start;

    /** 计划结束日（ISO date）；null=継続中（仅 kind=ops 允许） */
    @Column("end_date")
    private LocalDate end;

    /** 0-100，由任务汇总缓存一份，列表展示用 */
    private Integer progress;

    /** 同客户内的手动排序序号（升序；越小越靠前）。拖动排序时重写。 */
    @Column("sort_order")
    private Integer sortOrder;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;

    /**
     * 総工期・予定合計（分钟）：非持久化。列表读取时由 {@link ai.proyubi.pm.service.TaskRollupService}
     * 从该项目全任务实时集计（甘特 footer「総工期 予定」展示用），不落库。
     */
    @Column(ignore = true)
    private Long plannedTotalMinutes;

    /**
     * 総工期・実績合計（分钟）：非持久化。口径同上，含着手中(開始のみ)の手动工期。
     */
    @Column(ignore = true)
    private Long actualTotalMinutes;

    /**
     * 未完了の葉タスク件数（全期間）：非持久化。運用型プロジェクトの「滞留件数」。
     * 進捗率と違って分母を持たないため、タスクが随時追加されても数字が揺れない。
     */
    @Column(ignore = true)
    private Integer openTaskCount;

    /**
     * 今月の対象件数：非持久化。予定終了日が当月に入る葉タスク数（cancelled 除く）。
     */
    @Column(ignore = true)
    private Integer monthTotalCount;

    /**
     * 今月の完了件数：非持久化。{@link #monthTotalCount} のうち完了済み。
     */
    @Column(ignore = true)
    private Integer monthDoneCount;

    /**
     * 月次工数枠（分钟）：<b>永続</b>。保守契約の「月◯人日まで」を表す。null=枠なし。
     * 日本の保守契約は枠契約が大半で、現場が毎日見る数字は件数よりこの消化率。
     * 単位を分にしているのは {@link #plannedTotalMinutes} 等と口径を揃えるため
     * （人日 ↔ 分の換算は 1営業日の時間数＝テナント設定に従う）。
     */
    @Column("monthly_quota_minutes")
    private Integer monthlyQuotaMinutes;

    /**
     * 今月の消化工数・実績（分钟）：非持久化。予定終了日が当月の葉タスクの実績工期合計。
     */
    @Column(ignore = true)
    private Long monthActualMinutes;

    /**
     * 今月の予定工数（分钟）：非持久化。同じ母集団の予定工期合計。
     * 実績が未入力のうちは実績が 0 になるので、枠に対する見込みとして併記する。
     */
    @Column(ignore = true)
    private Long monthPlannedMinutes;
}

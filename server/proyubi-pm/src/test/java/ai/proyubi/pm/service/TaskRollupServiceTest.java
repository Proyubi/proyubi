package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmTask;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * TaskRollupService 汇总契约测试。
 * <p>
 * 这些规则必须与前端 {@code pm-web/src/pm/utils/tree.ts rollupSummaries} 逐值一致——
 * 两套实现并存（甘特前端二次 rollup），任一侧改动汇总口径都应让本测试与前端用例同步。
 */
class TaskRollupServiceTest {

    private final TaskRollupService svc = new TaskRollupService();
    private static final Set<LocalDate> NO_HOLIDAYS = Set.of();
    /** 1営業日=8時間（新既定）。工期换算はこの単位で行う。 */
    private static final double HPD = 8.0;

    private static PmTask task(String type, UUID id, UUID parent,
                               LocalDate start, LocalDate end, int progress,
                               LocalDate actualStart, LocalDate actualEnd) {
        PmTask t = new PmTask();
        t.setId(id);
        t.setParentId(parent);
        t.setType(type);
        t.setStart(start);
        t.setEnd(end);
        t.setProgress(progress);
        t.setActualStart(actualStart);
        t.setActualEnd(actualEnd);
        return t;
    }

    private static PmTask byId(List<PmTask> tasks, UUID id) {
        return tasks.stream().filter(t -> t.getId().equals(id)).findFirst().orElseThrow();
    }

    @Test
    void summaryStartEndProgressRollUpFromLeaves() {
        UUID sum = UUID.randomUUID();
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        // 两个等工期叶子（各 1 工作日），进度 0 / 100 → 加权 50
        List<PmTask> tasks = List.of(
            task("summary", sum, null, null, null, 0, null, null),
            task("task", a, sum, LocalDate.parse("2026-06-01"), LocalDate.parse("2026-06-01"), 0, null, null),
            task("task", b, sum, LocalDate.parse("2026-06-03"), LocalDate.parse("2026-06-03"), 100, null, null)
        );
        svc.rollup(tasks, NO_HOLIDAYS, HPD);
        PmTask s = byId(tasks, sum);
        assertEquals(LocalDate.parse("2026-06-01"), s.getStart(), "summary start=最早叶子");
        assertEquals(LocalDate.parse("2026-06-03"), s.getEnd(), "summary end=最晚叶子");
        assertEquals(50, s.getProgress(), "等工期叶子 0/100 → 加权 50");
    }

    @Test
    void emptySummaryStretchesToProjectSpan() {
        UUID emptySum = UUID.randomUUID();
        UUID realSum = UUID.randomUUID();
        UUID leaf = UUID.randomUUID();
        // emptySum 无叶子；项目跨度由唯一带日期叶子决定
        List<PmTask> tasks = List.of(
            task("summary", emptySum, null, null, null, 0, null, null),
            task("summary", realSum, null, null, null, 0, null, null),
            task("task", leaf, realSum, LocalDate.parse("2026-06-10"), LocalDate.parse("2026-06-20"), 0, null, null)
        );
        svc.rollup(tasks, NO_HOLIDAYS, HPD);
        PmTask es = byId(tasks, emptySum);
        assertEquals(LocalDate.parse("2026-06-10"), es.getStart(), "空 summary 拉伸到项目起");
        assertEquals(LocalDate.parse("2026-06-20"), es.getEnd(), "空 summary 拉伸到项目止");
        assertEquals(0, es.getProgress());
    }

    @Test
    void actualNotClosedUntilAllLeavesDone() {
        UUID sum = UUID.randomUUID();
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        // a 已完成（有 actualEnd），b 只开始未完成（无 actualEnd）→ ongoing，actualEnd 应为 null
        List<PmTask> tasks = List.of(
            task("summary", sum, null, null, null, 0, null, null),
            task("task", a, sum, LocalDate.parse("2026-06-01"), LocalDate.parse("2026-06-02"), 100,
                LocalDate.parse("2026-06-01"), LocalDate.parse("2026-06-02")),
            task("task", b, sum, LocalDate.parse("2026-06-03"), LocalDate.parse("2026-06-04"), 50,
                LocalDate.parse("2026-06-03"), null)
        );
        svc.rollup(tasks, NO_HOLIDAYS, HPD);
        PmTask s = byId(tasks, sum);
        assertEquals(LocalDate.parse("2026-06-01"), s.getActualStart(), "actualStart=最早叶子实绩起");
        assertNull(s.getActualEnd(), "未全完成 → actualEnd 不闭合");
        assertTrue(Boolean.TRUE.equals(s.getActualOngoing()), "未全完成 → actualOngoing=true");
    }

    @Test
    void decimalEffortHoursConvertToMinutes() {
        // 小时支持小数（0.25 刻み）→ 整数分钟。小时部分与 hoursPerDay 无关（恒 h*60）。
        assertEquals(15L, TaskRollupService.effortFromDH(0, 0.25, HPD), "0.25h = 15min");
        assertEquals(30L, TaskRollupService.effortFromDH(0, 0.5, HPD), "0.5h = 30min");
        assertEquals(45L, TaskRollupService.effortFromDH(null, 0.75, HPD), "0.75h = 45min");
        assertEquals(510L, TaskRollupService.effortFromDH(1, 0.5, HPD), "1d0.5h @8h = 8*60+30 = 510min");
        assertEquals(0L, TaskRollupService.effortFromDH(0, 0.0, HPD), "0d0h（手动0）= 0min");
        // hoursPerDay=24（旧固定口径）で従来値に一致することを担保（後方互換）
        assertEquals(1470L, TaskRollupService.effortFromDH(1, 0.5, 24.0), "旧24h口径: 1d0.5h = 24*60+30 = 1470min");
        // hoursPerDay=7.5（小数）: 2d = 2*7.5*60 = 900min
        assertEquals(900L, TaskRollupService.effortFromDH(2, 0.0, 7.5), "7.5h口径: 2d = 2*7.5*60 = 900min");
        // manualEffort：小数小时 > 0 即手动（与 hoursPerDay 无关）
        assertTrue(TaskRollupService.manualEffort(null, 0.5), "0.5h → 手动");
        assertTrue(TaskRollupService.manualEffort(0, null), "days=0（非空）→ 手动");
        assertFalse(TaskRollupService.manualEffort(null, 0.0), "皆空/0 → 非手动（回退期间派生）");
    }

    @Test
    void projectEffortTotalsCountsInProgressManualActual() {
        UUID sum = UUID.randomUUID();
        UUID done = UUID.randomUUID();
        UUID ongoing = UUID.randomUUID();
        UUID ms = UUID.randomUUID();
        // done：完了（実績両端）→ 実績=期間派生。ongoing：着手中（開始のみ）＋手填 8h。
        // milestone / summary 親は集計対象外。
        PmTask doneLeaf = task("task", done, sum,
            LocalDate.parse("2026-06-01"), LocalDate.parse("2026-06-01"), 100,
            LocalDate.parse("2026-06-01"), LocalDate.parse("2026-06-01"));
        PmTask ongoingLeaf = task("task", ongoing, sum,
            LocalDate.parse("2026-06-02"), LocalDate.parse("2026-06-02"), 30,
            LocalDate.parse("2026-06-02"), null);   // 着手中：actualEnd=null
        ongoingLeaf.setActualEffortHours(8.0);       // 実績 8h（手填）
        PmTask milestone = task("milestone", ms, sum,
            LocalDate.parse("2026-06-03"), LocalDate.parse("2026-06-03"), 0, null, null);
        List<PmTask> tasks = List.of(
            task("summary", sum, null, null, null, 0, null, null),
            doneLeaf, ongoingLeaf, milestone
        );
        TaskRollupService.EffortTotals totals = svc.projectEffortTotals(tasks, NO_HOLIDAYS, HPD);
        // 予定：2 叶子 各 1 営業日 = 8h=480min ×2 = 960（milestone/summary 除外）
        assertEquals(960L, totals.planned(), "予定=叶子予定期間の合計（milestone/summary 除く）");
        // 実績：done=1営業日 480 + 着手中の手填 8h=480 → 960（旧口径では着手中が落ちて 480 のみ）
        assertEquals(960L, totals.actual(), "実績=完了実績 + 着手中の手填工期");
    }

    @Test
    void manualActualEffortWithoutActualDatesCountsAsActual() {
        // 実績期間（開始/終了）を入れず、実績工期(d/h)だけ手填した葉子。
        // effortOf は予定套ではなく実績套（手填 2d6h）を採用し、footer 実績合計にも計上される。
        UUID id = UUID.randomUUID();
        PmTask leaf = task("task", id, null,
            LocalDate.parse("2026-06-01"), LocalDate.parse("2026-06-05"), 50, null, null);
        leaf.setActualEffortDays(2);
        leaf.setActualEffortHours(6.0);
        // effortOf：実績套 2d6h @8h = 2*8*60 + 6*60 = 1320min（予定期間派生 5営業日=2400min ではない）
        assertEquals(1320L, TaskRollupService.effortOf(leaf, NO_HOLIDAYS, HPD),
            "実績期間が無くても手填実績工期(2d6h)を採用");
        // 予定：期間派生 5営業日=2400 / 実績：手填 1320（着手日なしでも計上）
        TaskRollupService.EffortTotals totals = svc.projectEffortTotals(List.of(leaf), NO_HOLIDAYS, HPD);
        assertEquals(2400L, totals.planned(), "予定=予定期間 5営業日=2400min");
        assertEquals(1320L, totals.actual(), "実績=手填実績工期 2d6h=1320min（実績期間なしでも計上）");
    }

    @Test
    void actualClosesWhenAllLeavesDone() {
        UUID sum = UUID.randomUUID();
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        List<PmTask> tasks = List.of(
            task("summary", sum, null, null, null, 0, null, null),
            task("task", a, sum, LocalDate.parse("2026-06-01"), LocalDate.parse("2026-06-02"), 100,
                LocalDate.parse("2026-06-01"), LocalDate.parse("2026-06-02")),
            task("task", b, sum, LocalDate.parse("2026-06-03"), LocalDate.parse("2026-06-04"), 100,
                LocalDate.parse("2026-06-03"), LocalDate.parse("2026-06-05"))
        );
        svc.rollup(tasks, NO_HOLIDAYS, HPD);
        PmTask s = byId(tasks, sum);
        assertEquals(LocalDate.parse("2026-06-05"), s.getActualEnd(), "全完成 → actualEnd=最晚实绩止");
        assertFalse(Boolean.TRUE.equals(s.getActualOngoing()), "全完成 → 非 ongoing");
    }

    /**
     * 月次工数枠（運用型プロジェクト）の分母：<b>予定終了日が当月に入る葉タスクだけ</b>を集計する。
     * 前月・翌月の仕事が混ざると「今月 実績 / 枠」が枠契約の数字として使えなくなるため、
     * 境界（月初・月末）を含み、その外は含まないことを固定する。
     */
    @Test
    void monthEffortTotalsCountsOnlyLeavesEndingInTheMonth() {
        LocalDate from = LocalDate.parse("2026-08-01");
        LocalDate to = LocalDate.parse("2026-08-31");
        // 予定 1 営業日ずつ・実績も同じ 3 本。7/31（枠外）/ 8/03（月初側）/ 9/01（枠外）
        List<PmTask> tasks = List.of(
            task("task", UUID.randomUUID(), null,
                LocalDate.parse("2026-07-31"), LocalDate.parse("2026-07-31"), 100,
                LocalDate.parse("2026-07-31"), LocalDate.parse("2026-07-31")),
            task("task", UUID.randomUUID(), null,
                LocalDate.parse("2026-08-03"), LocalDate.parse("2026-08-03"), 100,
                LocalDate.parse("2026-08-03"), LocalDate.parse("2026-08-03")),
            task("task", UUID.randomUUID(), null,
                LocalDate.parse("2026-09-01"), LocalDate.parse("2026-09-01"), 0, null, null)
        );

        TaskRollupService.EffortTotals month = svc.monthEffortTotals(tasks, NO_HOLIDAYS, HPD, from, to);
        assertEquals(480, month.planned(), "当月に終わる葉 1 本ぶん（1営業日=8h=480分）だけ");
        assertEquals(480, month.actual(), "実績も同じ 1 本ぶんだけ");

        // 全期間の集計は 3 本すべて（実績は日付のある 2 本）
        TaskRollupService.EffortTotals all = svc.projectEffortTotals(tasks, NO_HOLIDAYS, HPD);
        assertEquals(1440, all.planned());
        assertEquals(960, all.actual());
    }

    /** 月末ちょうどに終わる葉は当月に含める（境界の閉じ方の固定）。 */
    @Test
    void monthEffortTotalsIncludesTasksEndingOnTheLastDay() {
        LocalDate from = LocalDate.parse("2026-08-01");
        LocalDate to = LocalDate.parse("2026-08-31");
        List<PmTask> tasks = List.of(
            task("task", UUID.randomUUID(), null,
                LocalDate.parse("2026-08-31"), LocalDate.parse("2026-08-31"), 100,
                LocalDate.parse("2026-08-31"), LocalDate.parse("2026-08-31"))
        );
        TaskRollupService.EffortTotals month = svc.monthEffortTotals(tasks, NO_HOLIDAYS, HPD, from, to);
        assertEquals(480, month.planned());
        assertEquals(480, month.actual());
    }
}

package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.service.TaskRollupService.WeightedProgress;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * サブプロジェクトの親進捗集計（{@link TaskRollupService#parentProgress} / {@link TaskRollupService#subProjectWeight}）。
 * 親進捗 = Σ(サブの予定工数 × サブ進捗) + Σ(親直下根タスクの工期 × 進捗) / Σ重み。
 */
class ParentProgressRollupTest {

    private final TaskRollupService svc = new TaskRollupService();
    private static final Set<LocalDate> NO_HOLIDAYS = Set.of();
    private static final double HPD = 8.0;
    /** 1 営業日 = 8h = 480 分 */
    private static final long DAY = 480;

    private static PmTask task(UUID parent, String start, String end, int progress) {
        PmTask t = new PmTask();
        t.setId(UUID.randomUUID());
        t.setParentId(parent);
        t.setType("task");
        t.setStart(LocalDate.parse(start));
        t.setEnd(LocalDate.parse(end));
        t.setProgress(progress);
        return t;
    }

    @Test
    void designExampleWeightedByEffortDays() {
        // design.md の例：要件定義 20日×100% ＋ アプリ改修 50日×60% ＋ 管理画面改修 30日×0% → 50%
        List<WeightedProgress> subs = List.of(
            new WeightedProgress(20 * DAY, 100),
            new WeightedProgress(50 * DAY, 60),
            new WeightedProgress(30 * DAY, 0));
        assertEquals(50, svc.parentProgress(List.of(), subs, NO_HOLIDAYS, HPD));
    }

    @Test
    void parentOwnRootTasksParticipate() {
        // 親直下タスク 5 営業日（2026-06-01 月〜06-05 金）100% ＋ サブ 5 日 0% → 50%
        List<PmTask> own = new ArrayList<>(List.of(task(null, "2026-06-01", "2026-06-05", 100)));
        List<WeightedProgress> subs = List.of(new WeightedProgress(5 * DAY, 0));
        assertEquals(50, svc.parentProgress(own, subs, NO_HOLIDAYS, HPD));
    }

    @Test
    void withoutSubsEqualsProjectProgress() {
        List<PmTask> a = new ArrayList<>(List.of(
            task(null, "2026-06-01", "2026-06-02", 100),
            task(null, "2026-06-03", "2026-06-10", 25)));
        List<PmTask> b = new ArrayList<>(List.of(
            task(null, "2026-06-01", "2026-06-02", 100),
            task(null, "2026-06-03", "2026-06-10", 25)));
        assertEquals(svc.projectProgress(a, NO_HOLIDAYS, HPD),
            svc.parentProgress(b, List.of(), NO_HOLIDAYS, HPD));
    }

    @Test
    void emptyEverythingIsZeroAndZeroWeightFloorsToOne() {
        assertEquals(0, svc.parentProgress(List.of(), List.of(), NO_HOLIDAYS, HPD));
        // 重み 0 のサブ 2 件（1 分の下駄で等重み）：100% と 0% → 50%
        assertEquals(50, svc.parentProgress(List.of(),
            List.of(new WeightedProgress(0, 100), new WeightedProgress(0, 0)), NO_HOLIDAYS, HPD));
    }

    @Test
    void subWeightIsPlannedEffortTotalWhenTasksExist() {
        UUID sum = UUID.randomUUID();
        PmTask summary = new PmTask();
        summary.setId(sum);
        summary.setType("summary");
        // 葉 2 件：3 営業日 + 2 営業日 = 5 日（summary 自身は二重計上しない）
        List<PmTask> tasks = new ArrayList<>(List.of(summary,
            task(sum, "2026-06-01", "2026-06-03", 0),
            task(sum, "2026-06-04", "2026-06-05", 0)));
        long w = svc.subProjectWeight(LocalDate.parse("2026-06-01"), LocalDate.parse("2026-06-30"),
            tasks, NO_HOLIDAYS, HPD);
        assertEquals(5 * DAY, w);
    }

    @Test
    void zeroEffortTasksDoNotUseTheWholeProjectPeriod() {
        PmTask milestone = task(null, "2026-06-01", "2026-06-01", 100);
        milestone.setType("milestone");
        assertEquals(0, svc.subProjectWeight(LocalDate.parse("2026-06-01"),
            LocalDate.parse("2026-06-30"), List.of(milestone), NO_HOLIDAYS, HPD));
    }

    @Test
    void subWeightFallsBackToPeriodWorkingDaysExcludingHolidays() {
        // 2026-06-01(月)〜06-12(金) = 10 営業日、うち 06-03 を祝日 → 9 日
        long w = svc.subProjectWeight(LocalDate.parse("2026-06-01"), LocalDate.parse("2026-06-12"),
            List.of(), Set.of(LocalDate.parse("2026-06-03")), HPD);
        assertEquals(9 * DAY, w);
    }

    @Test
    void subWeightWithoutEndCountsStartDayOnly() {
        assertEquals(DAY, svc.subProjectWeight(LocalDate.parse("2026-06-01"), null, List.of(), NO_HOLIDAYS, HPD));
        // 開始日が土曜なら 0（呼び出し側の 1 分下駄に任せる）
        assertEquals(0, svc.subProjectWeight(LocalDate.parse("2026-06-06"), null, List.of(), NO_HOLIDAYS, HPD));
    }

    @Test
    void subProgressIsClamped() {
        assertEquals(100, svc.parentProgress(List.of(),
            List.of(new WeightedProgress(DAY, 150)), NO_HOLIDAYS, HPD));
    }
}

package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmTask;
import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 任务汇总（Java 版，与前端 pm-web/src/pm/utils/tree.ts 保持同口径）。
 * <p>
 * summary 任务的 start/end 由叶子推导（start=最早、end=最晚，按自然日定位甘特条）；
 * progress 由叶子按「<b>工期</b>（分钟）」加权——工作日天数 + 手填小时
 * （{@link #effortOf}）。项目整体进度 = 根任务（同样按工期加权）汇总。
 *
 */
@Service
public class TaskRollupService {

    /**
     * 工作日天数 D：[start, end] 闭区间内、排除周六周日及 holidays（租户红日子）的自然日数（含首尾）。
     * 与前端 {@code date.ts workingDays} 逐值一致。start>end → 0。
     */
    public static long workingDays(LocalDate start, LocalDate end, Set<LocalDate> holidays) {
        if (start == null || end == null || end.isBefore(start)) {
            return 0;
        }
        long n = 0;
        for (LocalDate day = start; !day.isAfter(end); day = day.plusDays(1)) {
            if (!isNonWorkingDay(day, holidays)) {
                n++;
            }
        }
        return n;
    }

    /**
     * 工期（分钟）「自动工作日天数 D + 手填小时 H」模型，与前端 {@code date.ts effortMinutes} 逐值一致。
     * H > 0 → 把最后一天换成 H 小时，工期 =（D−1）天 + H 小时；H=0/空 → D 整天（每天 hoursPerDay 时）。
     * D ≤ 0（整段周末/红日子）→ 0。
     *
     * @param hoursPerDay 1営業日=何時間（租户配置，既定 8；旧固定 24）。天数部分按此换算成分钟。
     */
    public static long effortMinutes(LocalDate start, LocalDate end, Double effortHours,
                                     Set<LocalDate> holidays, double hoursPerDay) {
        long d = workingDays(start, end, holidays);
        if (d <= 0) {
            return 0;
        }
        // 防御性 clamp 到 [0,24)：兜底任何绕过 Controller 校验（如直连 API）的越界小时，避免污染加权工期。
        // 小时支持小数（0.25 刻み）→ 换算成整数分钟（四舍五入）。
        double h = clampHours(effortHours);
        long hMin = Math.round(h * 60);
        return hMin > 0
            ? Math.round((d - 1) * hoursPerDay * 60) + hMin
            : Math.round(d * hoursPerDay * 60);
    }

    /**
     * 手动工期（分钟）「日数 d + 小时 h」模型，与前端 {@code date.ts effortFromDH} 逐值一致。
     * effortFromDH = d*hoursPerDay*60 + h*60。days 负数兜底为 0；hours clamp 到 0–24（防直连绕过 Controller 校验越界）、缺省 0。
     * 例（hoursPerDay=8）：3d0h → 3*8*60=1440；1d6h → 1*8*60+6*60=840。
     *
     * @param hoursPerDay 1営業日=何時間（租户配置，既定 8；旧固定 24）。天数部分按此换算成分钟。
     */
    public static long effortFromDH(Integer days, Double hours, double hoursPerDay) {
        int d = Math.max(0, days != null ? days : 0);
        long hMin = Math.round(clampHours(hours) * 60);
        return Math.round(d * hoursPerDay * 60) + hMin;
    }

    /** 小时 clamp 到 [0,24)：负数/空→0，≥24→兜底到 23.99（防直连绕过 Controller 校验越界）。 */
    private static double clampHours(Double hours) {
        if (hours == null || hours <= 0) {
            return 0d;
        }
        return hours >= 24d ? 23.99d : hours;
    }

    /**
     * 「该套工期是否手动设置」开关，与前端 {@code date.ts isManualEffort} 逐值一致。
     * 手动＝日数(days) 非空 <b>或</b> 小时(hours) &gt; 0：用户填了 d/h 任一即按手动总量（effortFromDH(d,h)）；
     * 仅当两者皆空/0 时才回退按期间派生。注意「日=空 时间=4」→ 0d4h = 4h，区别于「日=空 时间=0」=期间派生。
     */
    public static boolean manualEffort(Integer days, Double hours) {
        return days != null || (hours != null && hours > 0);
    }

    /**
     * 同套工期（分钟）统一入口，与前端 {@code date.ts effortFor} 逐值一致：
     * 手动（{@link #manualEffort}）→ 手动 d/h（{@link #effortFromDH}），否则回退按期间派生（{@link #effortMinutes}）。
     * effortOf 是「実績套 or 予定套」的选择器，本方法则对<b>指定的一套</b>算工期——供 footer 総工期分别累计予定/実績用。
     */
    public static long effortForSet(LocalDate s, LocalDate e, Integer days, Double hours,
                                    Set<LocalDate> holidays, double hoursPerDay) {
        if (manualEffort(days, hours)) {
            return effortFromDH(days, hours, hoursPerDay);
        }
        return effortMinutes(s, e, hours, holidays, hoursPerDay);
    }

    /**
     * 任务工期（分钟）：rollup 加权 / 工期展示统一口径，与前端 {@code tree.ts effortOf} 一致。
     * milestone → 0；実績套を採用する条件＝実績期間两端齐全 <b>或</b> 実績工期(d/h)が手动设定済み
     * （実績期間を入れず実績工期だけ入力しても実绩として反映）；否则以予定套为准；
     * 同套手动（{@link #manualEffort}）→ 手动 d/h（{@link #effortFromDH}），否则回退按期间派生（{@link #effortMinutes}）。
     */
    public static long effortOf(PmTask t, Set<LocalDate> holidays, double hoursPerDay) {
        if (t == null || "milestone".equals(t.getType())) {
            return 0;
        }
        boolean useActual = (t.getActualStart() != null && t.getActualEnd() != null)
            || manualEffort(t.getActualEffortDays(), t.getActualEffortHours());
        // 実績期間が無い手动実績のみの场合、s/e は手动路径で未使用だが null 回避に予定日を代入
        LocalDate s = useActual && t.getActualStart() != null ? t.getActualStart() : t.getStart();
        LocalDate e = useActual && t.getActualEnd() != null ? t.getActualEnd() : t.getEnd();
        Double h = useActual ? t.getActualEffortHours() : t.getPlannedEffortHours();
        Integer days = useActual ? t.getActualEffortDays() : t.getPlannedEffortDays();
        if (manualEffort(days, h)) {
            return effortFromDH(days, h, hoursPerDay);
        }
        return effortMinutes(s, e, h, holidays, hoursPerDay);
    }

    private static boolean isNonWorkingDay(LocalDate day, Set<LocalDate> holidays) {
        DayOfWeek dow = day.getDayOfWeek();
        return dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY
            || (holidays != null && holidays.contains(day));
    }

    /**
     * 就地汇总 summary 任务的 start/end/progress（直接修改传入对象），并返回同一列表。
     *
     * @param holidays 租户红日子集合（用于工作日工期加权；可空=仅排除周末）
     * @param hoursPerDay 1営業日=何時間（租户配置，既定 8）；工期加权用
     */
    public List<PmTask> rollup(List<PmTask> tasks, Set<LocalDate> holidays, double hoursPerDay) {
        Map<UUID, List<PmTask>> childrenMap = new HashMap<>();
        for (PmTask t : tasks) {
            if (t.getParentId() != null) {
                childrenMap.computeIfAbsent(t.getParentId(), k -> new ArrayList<>()).add(t);
            }
        }

        // 项目整体跨度（所有叶子的最早 start ~ 最晚 end），用于「无带日期叶子」的空 summary 拉伸。
        // 与前端 tree.ts rollupSummaries 同口径（只看叶子=childrenMap 不含其 id 的任务）。
        LocalDate projStart = null;
        LocalDate projEnd = null;
        for (PmTask t : tasks) {
            if (childrenMap.containsKey(t.getId())) {
                continue;   // 有子=非叶子
            }
            if (t.getStart() != null && (projStart == null || t.getStart().isBefore(projStart))) {
                projStart = t.getStart();
            }
            if (t.getEnd() != null && (projEnd == null || t.getEnd().isAfter(projEnd))) {
                projEnd = t.getEnd();
            }
        }

        for (PmTask t : tasks) {
            if (!"summary".equals(t.getType())) {
                continue;
            }
            List<PmTask> leaves = leavesOf(t.getId(), childrenMap);
            // 空阶段（无带日期叶子）：拉伸到项目全程、进度 0（与前端一致，避免条形空白 / 两端口径分歧）
            if (leaves.isEmpty()) {
                if (projStart != null && projEnd != null) {
                    t.setStart(projStart);
                    t.setEnd(projEnd);
                    t.setProgress(0);
                }
                continue;
            }
            LocalDate minStart = null;
            LocalDate maxEnd = null;
            LocalDate minActualStart = null;
            LocalDate maxActualEnd = null;
            // 阶段「真正完成」= 全部叶子都有 actualEnd；否则实际终点未确定（ongoing）
            boolean allLeavesDone = true;
            long totalDur = 0;
            long weighted = 0;
            for (PmTask leaf : leaves) {
                if (leaf.getStart() != null && (minStart == null || leaf.getStart().isBefore(minStart))) {
                    minStart = leaf.getStart();
                }
                if (leaf.getEnd() != null && (maxEnd == null || leaf.getEnd().isAfter(maxEnd))) {
                    maxEnd = leaf.getEnd();
                }
                if (leaf.getActualStart() != null
                        && (minActualStart == null || leaf.getActualStart().isBefore(minActualStart))) {
                    minActualStart = leaf.getActualStart();
                }
                if (leaf.getActualEnd() != null
                        && (maxActualEnd == null || leaf.getActualEnd().isAfter(maxActualEnd))) {
                    maxActualEnd = leaf.getActualEnd();
                }
                if (leaf.getActualEnd() == null) {
                    allLeavesDone = false;
                }
                // 工期（分钟）加权；零/milestone 叶子兜底权重 1，避免被取整成 0
                long dur = Math.max(effortOf(leaf, holidays, hoursPerDay), 1);
                int progress = leaf.getProgress() != null ? leaf.getProgress() : 0;
                totalDur += dur;
                weighted += dur * progress;
            }
            // 实际条规则（与前端 tree.ts 一致，「全完了まで閉じない」）：
            // 未开始→不画；已开始未全完成→ongoing（actualEnd 未定）；全完成→闭合。
            boolean started = minActualStart != null;
            t.setStart(minStart);
            t.setEnd(maxEnd);
            t.setActualStart(started ? minActualStart : null);
            t.setActualEnd(started && allLeavesDone ? maxActualEnd : null);
            t.setActualOngoing(started && !allLeavesDone);
            t.setProgress(totalDur > 0 ? (int) Math.round((double) weighted / totalDur) : 0);
        }
        return tasks;
    }

    /** 项目整体进度 = 根任务（按工作日工期加权）汇总。会先对传入列表执行 rollup。 */
    public int projectProgress(List<PmTask> tasks, Set<LocalDate> holidays, double hoursPerDay) {
        rollup(tasks, holidays, hoursPerDay);
        long totalDur = 0;
        long weighted = 0;
        for (PmTask t : tasks) {
            if (t.getParentId() != null) {
                continue;
            }
            long dur = Math.max(effortOf(t, holidays, hoursPerDay), 1);
            int progress = t.getProgress() != null ? t.getProgress() : 0;
            totalDur += dur;
            weighted += dur * progress;
        }
        return totalDur > 0 ? (int) Math.round((double) weighted / totalDur) : 0;
    }

    /** 親進捗の集計単位：重み（分钟）と進捗（0-100）。 */
    public record WeightedProgress(long weightMinutes, int progress) {
    }

    /**
     * サブプロジェクトの重み（分钟）＝親進捗の加重に使う「工数」。
     * <ol>
     *   <li>タスクがあれば予定工数の合計（{@link #projectEffortTotals}.planned＝営業日/祝日カレンダー基準）</li>
     *   <li>タスクが無ければ、サブの期間 start..end の営業日数 × hoursPerDay</li>
     *   <li>end が null（継続中；v1 ではサブは ops 不可なので通常は起きない）なら start の 1 日分だけで数える</li>
     * </ol>
     * どれでも 0 になる場合（期間が全部休日など）は呼び出し側で 1 分の下駄を履かせる（タスク加重と同じ兜底）。
     */
    public long subProjectWeight(LocalDate start, LocalDate end, List<PmTask> subTasks,
                                 Set<LocalDate> holidays, double hoursPerDay) {
        if (subTasks != null && !subTasks.isEmpty()) {
            return projectEffortTotals(subTasks, holidays, hoursPerDay).planned();
        }
        LocalDate e = end != null ? end : start;
        return Math.round(workingDays(start, e, holidays) * hoursPerDay * 60);
    }

    /**
     * 親プロジェクトの進捗 = Σ(サブの重み × サブ進捗) + Σ(親直下の根タスクの工期 × 進捗) / Σ重み。
     * <p>
     * 親直下タスクの重みは {@link #projectProgress} と同じ（rollup 後の根タスク {@link #effortOf}、0 は 1 に兜底）。
     * サブの重みは {@link #subProjectWeight}（0 は 1 に兜底）。単位はどちらも分钟なので混ぜて加重できる。
     * サブが無ければ {@link #projectProgress} と一致する。全体の重みが 0 なら 0。
     */
    public int parentProgress(List<PmTask> ownTasks, List<WeightedProgress> subs,
                              Set<LocalDate> holidays, double hoursPerDay) {
        long totalDur = 0;
        long weighted = 0;
        if (ownTasks != null && !ownTasks.isEmpty()) {
            rollup(ownTasks, holidays, hoursPerDay);
            for (PmTask t : ownTasks) {
                if (t.getParentId() != null) {
                    continue;
                }
                long dur = Math.max(effortOf(t, holidays, hoursPerDay), 1);
                int progress = t.getProgress() != null ? t.getProgress() : 0;
                totalDur += dur;
                weighted += dur * progress;
            }
        }
        if (subs != null) {
            for (WeightedProgress s : subs) {
                long w = Math.max(s.weightMinutes(), 1);
                int progress = Math.max(0, Math.min(100, s.progress()));
                totalDur += w;
                weighted += w * progress;
            }
        }
        return totalDur > 0 ? (int) Math.round((double) weighted / totalDur) : 0;
    }

    /** 项目総工期（分钟）合计：予定/実績 各自累计。列表页/甘特 footer「総工期 予定/実績」展示用。 */
    public record EffortTotals(long planned, long actual) {
    }

    /**
     * 项目総工期合计（分钟）：叶子任务（有子的 summary / milestone 除外，避免重复计）逐个累加。
     * 与前端 {@code TaskTreeTable} footer 口径逐值一致：
     * <ul>
     *   <li>予定：每个叶子都按予定套（{@link #effortForSet}）累计；</li>
     *   <li>実績：両端そろう <b>or</b> 実績工期(手动 d/h)があれば計上（実績期間を入れず実績工期だけ
     *       入力した葉子・着手中＝開始のみの手填工期も実績に含める）。手动時は effortFromDH、
     *       完了(両端そろう)時は実績期間から派生。</li>
     * </ul>
     */
    public EffortTotals projectEffortTotals(List<PmTask> tasks, Set<LocalDate> holidays, double hoursPerDay) {
        return effortTotals(tasks, holidays, hoursPerDay, t -> true);
    }

    /**
     * 期間で絞った工期合計（分钟）。運用型プロジェクトの「今月の消化工数 / 契約枠」表示用。
     * <p>
     * 対象は <b>予定終了日が [from, to] に入る葉タスク</b>——「今月やる予定だった仕事」という括り。
     * 実績日付ではなく予定終了日で切るのは、件数（{@code monthTotalCount}）と同じ母集団にして
     * 「今月 3/5 件・実績 12d4h / 枠 20d」が同じ仕事を指すようにするため。
     * 集計ロジック自体は {@link #projectEffortTotals} と同一。
     */
    public EffortTotals monthEffortTotals(List<PmTask> tasks, Set<LocalDate> holidays, double hoursPerDay,
                                          LocalDate from, LocalDate to) {
        return effortTotals(tasks, holidays, hoursPerDay,
            t -> t.getEnd() != null && !t.getEnd().isBefore(from) && !t.getEnd().isAfter(to));
    }

    private EffortTotals effortTotals(List<PmTask> tasks, Set<LocalDate> holidays, double hoursPerDay,
                                      java.util.function.Predicate<PmTask> include) {
        Set<UUID> parentIds = new java.util.HashSet<>();
        for (PmTask t : tasks) {
            if (t.getParentId() != null) {
                parentIds.add(t.getParentId());
            }
        }
        long planned = 0;
        long actual = 0;
        for (PmTask t : tasks) {
            // 有子（summary 親）/ milestone は集計対象外（叶子のみ）
            if (parentIds.contains(t.getId()) || "milestone".equals(t.getType())) {
                continue;
            }
            if (!include.test(t)) {
                continue;
            }
            planned += effortForSet(t.getStart(), t.getEnd(),
                t.getPlannedEffortDays(), t.getPlannedEffortHours(), holidays, hoursPerDay);
            boolean actualValid = (t.getActualStart() != null && t.getActualEnd() != null)
                || manualEffort(t.getActualEffortDays(), t.getActualEffortHours());
            if (actualValid) {
                // 実績期間が欠ける（実績工期のみ/着手中）場合は手动路径＝s/e 未使用だが、null 回避で予定/開始日を代入
                LocalDate as = t.getActualStart() != null ? t.getActualStart() : t.getStart();
                LocalDate ae = t.getActualEnd() != null ? t.getActualEnd() : as;
                actual += effortForSet(as, ae,
                    t.getActualEffortDays(), t.getActualEffortHours(), holidays, hoursPerDay);
            }
        }
        return new EffortTotals(planned, actual);
    }

    /** 递归取某任务下所有叶子（不含自身；自身有子才算 summary） */
    private List<PmTask> leavesOf(UUID taskId, Map<UUID, List<PmTask>> childrenMap) {
        List<PmTask> kids = childrenMap.get(taskId);
        if (kids == null || kids.isEmpty()) {
            return List.of();
        }
        List<PmTask> out = new ArrayList<>();
        for (PmTask kid : kids) {
            List<PmTask> sub = leavesOf(kid.getId(), childrenMap);
            if (sub.isEmpty()) {
                out.add(kid);
            } else {
                out.addAll(sub);
            }
        }
        return out;
    }
}

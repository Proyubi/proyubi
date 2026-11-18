import * as XLSX from "xlsx";
import type { Member, WorkloadItem } from "../types";
import { fmtDuration, getHoursPerDay } from "../utils/date";

/** 工時実績サマリーの集計値（ResourceStats と同一口径） */
export interface StatsAgg {
  actualSum: number;
  plannedSum: number;
  taskCount: number;
  doneCount: number;
  wipCount: number;
  consumption: number | null;
}

type TFn = (id: string, values?: Record<string, string | number>) => string;

/** タスクの実績ステータス（進捗 + 実績日から導出） */
function statusKey(it: WorkloadItem): "done" | "ongoing" | "wip" | "todo" {
  if ((it.progress ?? 0) >= 100) return "done";
  if (it.actualStart && !it.actualEnd) return "ongoing";
  if (it.actualStart) return "wip";
  return "todo";
}

const DASH = "—";
const day = (v: string | null) => v ?? DASH;

/**
 * 工時実績サマリーを Excel（2 シート）で出力。
 * - シート1「概要」：メンバー / 期間 + KPI 数値（画面のカードと同値）。
 * - シート2「タスク一覧」：集計対象（月窗に交叠する担当叶子タスク）を条件そのままに列挙。
 * データ・口径は画面と一致（後端算出の plannedMinutes/actualMinutes を合計/整形するだけ）。
 */
export function exportResourceStats(opts: {
  member?: Member;
  range: { start: string; end: string } | null;
  rows: WorkloadItem[];
  agg: StatsAgg;
  members: Member[];
  t: TFn;
}): void {
  const { member, range, rows, agg, members, t } = opts;
  const memberMap = new Map(members.map((m) => [m.id, m.name]));
  const period = range
    ? `${range.start.slice(0, 7)} 〜 ${range.end.slice(0, 7)}`
    : t("resources.stats.export.allPeriod");

  const deltaMin = agg.actualSum - agg.plannedSum;
  const deltaLabel =
    agg.consumption == null
      ? t("resources.stats.kpi.noPlan")
      : deltaMin >= 0
        ? t("resources.stats.kpi.over", { v: fmtDuration(deltaMin) })
        : t("resources.stats.kpi.remain", { v: fmtDuration(-deltaMin) });

  // ===== シート1：概要 =====
  const s1: (string | number)[][] = [
    [t("resources.stats.title")],
    [t("resources.stats.export.member"), member?.name ?? DASH],
    [t("resources.stats.export.period"), period],
    [],
    [t("resources.stats.export.metric"), t("resources.stats.export.value")],
    [t("resources.stats.kpi.actual"), fmtDuration(agg.actualSum)],
    [t("resources.stats.kpi.planned"), fmtDuration(agg.plannedSum)],
    [
      t("resources.stats.kpi.rate"),
      agg.consumption == null ? DASH : `${agg.consumption}%`,
    ],
    [t("resources.stats.export.delta"), deltaLabel],
    [t("resources.stats.kpi.tasks"), agg.taskCount],
    [t("resources.stats.export.doneLabel"), agg.doneCount],
    [t("resources.stats.export.wipLabel"), agg.wipCount],
    [],
    [t("resources.stats.hint", { hpd: getHoursPerDay() })],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  ws1["!cols"] = [{ wch: 18 }, { wch: 40 }];

  // ===== シート2：タスク一覧 =====
  const header = [
    t("resources.stats.export.col.name"),
    t("resources.stats.export.col.customer"),
    t("resources.col.project"),
    t("resources.col.assignee"),
    t("resources.stats.export.col.status"),
    t("resources.col.progress"),
    t("resources.stats.export.col.planStart"),
    t("resources.stats.export.col.planEnd"),
    t("resources.stats.export.col.actualStart"),
    t("resources.stats.export.col.actualEnd"),
    t("resources.stats.kpi.planned"),
    t("resources.stats.kpi.actual"),
  ];
  const body = rows.map((it) => [
    it.name,
    it.customerName ?? DASH,
    it.projectName ?? DASH,
    (it.assigneeIds ?? []).map((id) => memberMap.get(id) ?? id).join("、") ||
      DASH,
    t(`resources.stats.export.status.${statusKey(it)}`),
    `${it.progress ?? 0}%`,
    day(it.start),
    day(it.end),
    day(it.actualStart),
    day(it.actualEnd),
    fmtDuration(it.plannedMinutes ?? 0),
    fmtDuration(it.actualMinutes ?? 0),
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws2["!cols"] = [
    { wch: 28 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
    { wch: 10 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, t("resources.stats.export.sheet1"));
  XLSX.utils.book_append_sheet(wb, ws2, t("resources.stats.export.sheet2"));

  const safe = (member?.name ?? "member").replace(/[\\/:*?"<>|]/g, "_");
  const periodFile = range
    ? `${range.start.slice(0, 7)}_${range.end.slice(0, 7)}`
    : t("resources.stats.export.allPeriod");
  XLSX.writeFile(
    wb,
    `${t("resources.stats.title")}_${safe}_${periodFile}.xlsx`
  );
}

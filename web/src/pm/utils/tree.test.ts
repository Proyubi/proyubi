import type { Task } from "../types";
import { aggregateEfforts } from "./tree";

/**
 * 汇总行の工期は「后代叶子の工期合計」。自身の期間跨度（最早開始〜最晩終了）を
 * 使うと、子が長い予定期間 + 短い手动工期のとき footer 総工期と対不上になる。
 */
function task(
  id: string,
  parentId: string | null,
  patch: Partial<Task> = {}
): Task {
  return {
    id,
    projectId: "p1",
    parentId,
    name: id,
    // 月〜金の 5 営業日
    start: "2026-09-07",
    end: "2026-09-11",
    progress: 0,
    assigneeIds: [],
    levels: [],
    type: "task",
    order: 0,
    ...patch,
  } as unknown as Task;
}

const H = 60;
const D = 8 * H; // hoursPerDay 既定 8

//  root (summary)
//    ├ phase (summary)
//    │   ├ a  手动 1d
//    │   └ b  手动 2d4h
//    ├ c      手动なし → 予定期間 5 営業日
//    └ m      milestone → 0
const TASKS: Task[] = [
  task("root", null, { type: "summary" }),
  task("phase", "root", { type: "summary" }),
  task("a", "phase", { plannedEffortDays: 1 }),
  task("b", "phase", { plannedEffortDays: 2, plannedEffortHours: 4 }),
  task("c", "root"),
  task("m", "root", { type: "milestone", plannedEffortDays: 9 }),
];

describe("aggregateEfforts", () => {
  it("手动工期があればそれを、無ければ予定期間を、叶子ぶん合計する", () => {
    const agg = aggregateEfforts(TASKS);
    expect(agg.get("phase")?.planned).toBe(3 * D + 4 * H);
    // phase(3d4h) + c(5d)、milestone は 0
    expect(agg.get("root")?.planned).toBe(8 * D + 4 * H);
  });

  it("叶子には集計を持たせない", () => {
    const agg = aggregateEfforts(TASKS);
    expect(agg.has("a")).toBe(false);
    expect(agg.has("c")).toBe(false);
  });

  it("実績は 両端そろう or 手动実績 の叶子だけ計上する", () => {
    const agg = aggregateEfforts([
      task("s", null, { type: "summary" }),
      // 実績期間 2 営業日
      task("x", "s", { actualStart: "2026-09-07", actualEnd: "2026-09-08" }),
      // 実績期間なし・実績工期のみ手动
      task("y", "s", { actualEffortHours: 3 }),
      // 着手のみ（終了なし・手动なし）→ 計上しない
      task("z", "s", { actualStart: "2026-09-07" }),
    ]);
    expect(agg.get("s")?.actual).toBe(2 * D + 3 * H);
    expect(agg.get("s")?.planned).toBe(15 * D);
  });
});

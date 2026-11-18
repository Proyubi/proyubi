import type { Bug } from "../types";
import {
  bugAgeDays,
  bugDisplayNo,
  bugOverview,
  filterBugs,
  mondayOf,
  parseBugSeq,
  UNASSIGNED,
  WHOLE_PRODUCT,
} from "./bug";

function bug(seq: number, patch: Partial<Bug> = {}): Bug {
  return {
    id: `b${seq}`,
    customerId: "c1",
    seq,
    bugNo: `BUG-${String(seq).padStart(3, "0")}`,
    title: `バグ ${seq}`,
    severity: "medium",
    priority: "medium",
    status: "open",
    reopenCount: 0,
    reporterUserId: "u1",
    reportedOn: "2026-09-15",
    ...patch,
  };
}

describe("bugDisplayNo", () => {
  it("seq をゼロ埋めせずに出す（1000 件目以降も桁が崩れない）", () => {
    expect(bugDisplayNo({ seq: 7 })).toBe("#7");
    expect(bugDisplayNo({ seq: 1000, bugNo: "BUG-1000" })).toBe("#1000");
  });
  it("seq が無い検索ヒットは bug_no から番号を取る", () => {
    expect(bugDisplayNo({ bugNo: "BUG-067" })).toBe("#67");
    expect(bugDisplayNo({ bugNo: "X" })).toBe("X");
  });
});

describe("parseBugSeq", () => {
  it.each([
    ["67", 67],
    ["#67", 67],
    ["BUG-067", 67],
    ["bug67", 67],
    [" #0067 ", 67],
  ])("%s → %d", (kw, n) => expect(parseBugSeq(kw)).toBe(n));
  it("番号でなければ null", () => {
    expect(parseBugSeq("教室")).toBeNull();
    expect(parseBugSeq("67a")).toBeNull();
  });
});

describe("filterBugs", () => {
  const bugs = [
    bug(1, { status: "closed", resolvedAt: "2026-09-16T10:00:00" }),
    bug(2, { assigneeMemberId: "m1", projectId: "p1", taskId: "t1" }),
    bug(3, { severity: "high", title: "code=500 で保存失敗" }),
    bug(67, { title: "教室マスタ" }),
    bug(167, { title: "関係ない" }),
  ];
  const base = { status: "all" as const, keyword: "" };

  it("既定の active は完了/対応せずを除く", () => {
    expect(
      filterBugs(bugs, { ...base, status: "active" }).map((b) => b.seq)
    ).toEqual([2, 3, 67, 167]);
  });

  it("#67 は seq 完全一致（167 は拾わない）", () => {
    expect(
      filterBugs(bugs, { ...base, keyword: "#67" }).map((b) => b.seq)
    ).toEqual([67]);
  });

  it("数字がタイトルに含まれる場合も部分一致で拾う", () => {
    expect(
      filterBugs(bugs, { ...base, keyword: "500" }).map((b) => b.seq)
    ).toEqual([3]);
  });

  it("未割当・製品全体・タスク紐付けなし", () => {
    const r = filterBugs(bugs, {
      ...base,
      assignee: UNASSIGNED,
      project: WHOLE_PRODUCT,
      task: "unlinked",
    });
    expect(r.map((b) => b.seq)).toEqual([1, 3, 67, 167]);
  });

  it("完了日の範囲指定は完了日なしを除外する", () => {
    const r = filterBugs(bugs, {
      ...base,
      resolved: ["2026-09-16", null],
    });
    expect(r.map((b) => b.seq)).toEqual([1]);
  });
});

describe("bugOverview", () => {
  it("未完了・高・未割当・最古・今週を数える", () => {
    const o = bugOverview(
      [
        bug(1, { status: "closed", resolvedAt: "2026-09-14T09:00:00" }),
        bug(2, { severity: "high", reportedOn: "2026-08-01" }),
        bug(3, { assigneeMemberId: "m1" }),
      ],
      "2026-09-17"
    );
    expect(o).toEqual({
      active: 2,
      total: 3,
      activeHighSeverity: 1,
      activeUnassigned: 1,
      oldestActiveDays: 47,
      reportedThisWeek: 2,
      resolvedThisWeek: 1,
    });
  });

  it("月曜始まりの週", () => {
    expect(mondayOf("2026-09-17")).toBe("2026-09-14");
    expect(mondayOf("2026-09-20")).toBe("2026-09-14");
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
  });

  it("経過日数", () => {
    expect(bugAgeDays("2026-09-15", "2026-09-17")).toBe(2);
    expect(bugAgeDays(null, "2026-09-17")).toBeNull();
  });
});

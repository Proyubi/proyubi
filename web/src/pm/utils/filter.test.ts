import type { Task } from "../types";
import { matchTasks } from "./filter";

/**
 * 木構造の絞り込みは「祖先を残す」「ヒットした枝は丸ごと残す」の 2 つが崩れやすい。
 * 特に、祖先として先に keepIds に入った枝が後からヒットしたケース（下の "hit order"）は
 * 訪問済み判定を keepIds と兼用すると子孫を取りこぼす。
 */
function task(id: string, name: string, parentId: string | null = null): Task {
  return {
    id,
    projectId: "p1",
    parentId,
    name,
    start: "2026-09-01",
    end: "2026-09-02",
    progress: 0,
    assigneeIds: [],
    levels: [],
    type: "task",
    order: 0,
  } as unknown as Task;
}

//  設計          (s1)
//    ├ API 設計   (t1)
//    └ 画面設計   (t2)
//  テスト        (s2)
//    └ 結合テスト (t3)
const TASKS: Task[] = [
  task("s1", "設計"),
  task("t1", "API 設計", "s1"),
  task("t2", "画面設計", "s1"),
  task("s2", "テスト"),
  task("t3", "結合テスト", "s2"),
];

describe("matchTasks", () => {
  it("キーワード空なら絞り込みなし", () => {
    const r = matchTasks(TASKS, "  ");
    expect(r.keepIds).toBeNull();
    expect(r.hitCount).toBe(0);
  });

  it("一致した葉の祖先を文脈として残す", () => {
    const r = matchTasks(TASKS, "API");
    expect(r.hitIds).toEqual(new Set(["t1"]));
    // t1 とその祖先 s1 のみ。兄弟 t2 と別枝は落ちる
    expect(r.keepIds).toEqual(new Set(["t1", "s1"]));
    expect(r.hitCount).toBe(1);
  });

  it("大小文字を無視する", () => {
    expect(matchTasks(TASKS, "api").hitIds).toEqual(new Set(["t1"]));
  });

  it("ヒットが親なら子孫ごと残す", () => {
    const r = matchTasks(TASKS, "テスト");
    // s2 と t3 が名前でヒット、t3 は s2 の子孫としても残る
    expect(r.hitIds).toEqual(new Set(["s2", "t3"]));
    expect(r.keepIds).toEqual(new Set(["s2", "t3"]));
  });

  it("先に祖先として残った枝が後からヒットしても子孫を取りこぼさない", () => {
    // "設計" は s1（親）と t1/t2（子）の両方にヒットする。
    // 子を先に処理して s1 を祖先として keepIds に入れた後、s1 自身のヒットを
    // 「訪問済み」と誤判定すると、s1 の子孫展開がスキップされる。
    const r = matchTasks(TASKS, "設計");
    expect(r.hitIds).toEqual(new Set(["s1", "t1", "t2"]));
    expect(r.keepIds).toEqual(new Set(["s1", "t1", "t2"]));
  });

  it("一致なしなら keepIds は空（＝全行非表示）", () => {
    const r = matchTasks(TASKS, "ぬるぽ");
    expect(r.hitCount).toBe(0);
    expect(r.keepIds).toEqual(new Set());
  });
});

import type { Project } from "../types";
import {
  extendedParentRange,
  groupChildren,
  isOverdueWithSubs,
  subSummary,
} from "./projectTree";

function project(
  id: string,
  over: Partial<Project> = {}
): Project {
  return {
    id,
    customerId: "c1",
    name: id,
    status: "active",
    start: "2026-09-01",
    end: "2099-12-31",
    progress: 0,
    ...over,
  };
}

describe("projectTree", () => {
  it("groups children by parentId keeping list order", () => {
    const m = groupChildren([
      project("a"),
      project("a2", { parentId: "a" }),
      project("b"),
      project("a1", { parentId: "a" }),
    ]);
    expect(m.get("a")?.map((p) => p.id)).toEqual(["a2", "a1"]);
    expect(m.has("b")).toBe(false);
  });

  it("summarises sub counts, done and overdue", () => {
    const subs = [
      project("s1", { status: "done", progress: 100 }),
      project("s2", { end: "2020-01-01" }),
      project("s3"),
    ];
    expect(subSummary(subs)).toEqual({
      count: 3,
      done: 1,
      overdue: 1,
      allDone: false,
    });
    expect(subSummary([project("x", { status: "done" })]).allDone).toBe(true);
    expect(subSummary(undefined).allDone).toBe(false);
  });

  it("treats a parent as overdue when any sub is overdue", () => {
    const parent = project("p");
    expect(isOverdueWithSubs(parent, [project("s")])).toBe(false);
    expect(
      isOverdueWithSubs(parent, [project("s", { end: "2020-01-01" })])
    ).toBe(true);
    // 納品済みのサブは期限超過にしない
    expect(
      isOverdueWithSubs(parent, [
        project("s", { end: "2020-01-01", status: "done" }),
      ])
    ).toBe(false);
  });

  it("detects a sub period outside the parent period", () => {
    const parent = { start: "2026-09-01", end: "2027-01-31" };
    expect(extendedParentRange(parent, "2026-12-01", "2027-01-15")).toBeNull();
    expect(extendedParentRange(parent, "2026-08-01", "2027-02-10")).toEqual({
      start: "2026-08-01",
      end: "2027-02-10",
    });
    // 親が継続中（終了日なし）なら終了側ははみ出さない
    expect(
      extendedParentRange({ start: "2026-09-01", end: null }, "2026-10-01", "2030-01-01")
    ).toBeNull();
  });
});

import type { Bug, BugStatus, QcPriority } from "../types";

/**
 * バグ一覧の表示・絞り込みロジック（品質管理 › バグ管理）。
 * UI から切り離した純関数にしてあるのは Jest で押さえるため。
 */

/** 「未完了」扱いの状態。既定の一覧・件数・概況はこの集合で数える。 */
export const ACTIVE_BUG_STATUSES: BugStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "verifying",
];

export function isActiveBug(status: BugStatus): boolean {
  return ACTIVE_BUG_STATUSES.includes(status);
}

/**
 * 表示用のバグ番号 `#67`。DB の bug_no（`BUG-067`）はゼロ埋め 3 桁で
 * 1000 件目から桁が崩れ、文字列ソートも狂うため、画面では seq をそのまま出す。
 * seq を持たない検索ヒット等は bug_no から数字部分を取り出す。
 */
export function bugDisplayNo(b: {
  seq?: number | null;
  bugNo?: string | null;
}): string {
  if (b.seq != null) return `#${b.seq}`;
  const m = b.bugNo?.match(/(\d+)\s*$/);
  if (m) return `#${Number(m[1])}`;
  return b.bugNo ?? "";
}

/** `67` / `#67` / `BUG-067` / `bug-67` → 67。番号指定でなければ null。 */
export function parseBugSeq(keyword: string): number | null {
  const m = keyword.trim().match(/^(?:#|bug-?)?0*(\d+)$/i);
  return m ? Number(m[1]) : null;
}

export type DateRange = [string | null, string | null] | null;

export interface BugFilters {
  /** "active"(未完了) / "all" / 個別の状態 */
  status: "active" | "all" | BugStatus;
  keyword: string;
  severity?: QcPriority;
  priority?: QcPriority;
  /** pm_member.id / "__none__"(未割当) */
  assignee?: string;
  /** pm_project.id / "__whole__"(製品全体＝版本未指定) */
  project?: string;
  /** "linked" / "unlinked" */
  task?: "linked" | "unlinked";
  reporter?: string;
  /** pm_environment.id / "legacy:<表示ラベル>"(旧・自由入力) */
  environment?: string;
  /** "YYYY-MM-DD" の両端含む範囲。片側 null は無制限 */
  reported?: DateRange;
  resolved?: DateRange;
}

export const UNASSIGNED = "__none__";
export const WHOLE_PRODUCT = "__whole__";
export const LEGACY_ENV_PREFIX = "legacy:";

function inRange(ymd: string | null | undefined, range?: DateRange): boolean {
  if (!range) return true;
  const [start, end] = range;
  if (!start && !end) return true;
  if (!ymd) return false; // 範囲指定時、値なし(未完了など)は除外
  const d = ymd.slice(0, 10);
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

export function matchBugStatus(
  b: Pick<Bug, "status">,
  status: BugFilters["status"]
): boolean {
  if (status === "all") return true;
  if (status === "active") return isActiveBug(b.status);
  return b.status === status;
}

/** 状態以外の条件で絞る（状態チップの件数は「状態以外で絞った集合」で数えるため分けてある）。 */
export function filterBugsExceptStatus(
  bugs: Bug[],
  f: Omit<BugFilters, "status">
): Bug[] {
  const kw = f.keyword.trim().toLowerCase();
  const seq = kw ? parseBugSeq(kw) : null;
  return bugs.filter((b) => {
    if (f.severity && b.severity !== f.severity) return false;
    if (f.priority && b.priority !== f.priority) return false;
    if (f.assignee) {
      if (f.assignee === UNASSIGNED) {
        if (b.assigneeMemberId) return false;
      } else if (b.assigneeMemberId !== f.assignee) return false;
    }
    if (f.project) {
      if (f.project === WHOLE_PRODUCT) {
        if (b.projectId) return false;
      } else if (b.projectId !== f.project) return false;
    }
    if (f.task === "linked" && !b.taskId) return false;
    if (f.task === "unlinked" && b.taskId) return false;
    if (f.reporter && b.reporterUserId !== f.reporter) return false;
    if (f.environment) {
      if (f.environment.startsWith(LEGACY_ENV_PREFIX)) {
        const label = f.environment.slice(LEGACY_ENV_PREFIX.length);
        if (b.environmentId || b.environment !== label) return false;
      } else if (b.environmentId !== f.environment) return false;
    }
    if (!inRange(b.reportedOn, f.reported)) return false;
    if (!inRange(b.resolvedAt, f.resolved)) return false;
    if (kw) {
      // 番号指定（#67 等）は seq 完全一致、それ以外（や数字がタイトルに含まれる場合）は部分一致
      if (seq != null && b.seq === seq) return true;
      const hay = `${b.bugNo} ${b.title} ${b.description ?? ""}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

export function filterBugs(bugs: Bug[], f: BugFilters): Bug[] {
  return filterBugsExceptStatus(bugs, f).filter((b) =>
    matchBugStatus(b, f.status)
  );
}

/** 起票日からの経過日数（today 基準、日単位）。 */
export function bugAgeDays(
  reportedOn: string | null | undefined,
  today: string
): number | null {
  if (!reportedOn) return null;
  const a = Date.parse(`${reportedOn.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** 未完了バグの概況（表上部の概況行）。 */
export interface BugOverview {
  active: number;
  total: number;
  activeHighSeverity: number;
  activeUnassigned: number;
  /** 最古の未完了の経過日数（未完了なしは null） */
  oldestActiveDays: number | null;
  reportedThisWeek: number;
  resolvedThisWeek: number;
}

/** today を含む週の月曜日（YYYY-MM-DD）。 */
export function mondayOf(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 月=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export function bugOverview(bugs: Bug[], today: string): BugOverview {
  const monday = mondayOf(today);
  const o: BugOverview = {
    active: 0,
    total: bugs.length,
    activeHighSeverity: 0,
    activeUnassigned: 0,
    oldestActiveDays: null,
    reportedThisWeek: 0,
    resolvedThisWeek: 0,
  };
  for (const b of bugs) {
    if (b.reportedOn && b.reportedOn.slice(0, 10) >= monday)
      o.reportedThisWeek++;
    if (b.resolvedAt && b.resolvedAt.slice(0, 10) >= monday)
      o.resolvedThisWeek++;
    if (!isActiveBug(b.status)) continue;
    o.active++;
    if (b.severity === "high") o.activeHighSeverity++;
    if (!b.assigneeMemberId) o.activeUnassigned++;
    const age = bugAgeDays(b.reportedOn, today);
    if (age != null && (o.oldestActiveDays == null || age > o.oldestActiveDays))
      o.oldestActiveDays = age;
  }
  return o;
}

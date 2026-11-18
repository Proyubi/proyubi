import { PROJECT_STATUS_META, type Project, type ProjectStatus, type Task } from "@/pm/types";

/** Display only: never persist derived work progress as a delivery decision. */
export type ProjectDisplayStatus = ProjectStatus | "ready";
export const PROJECT_DISPLAY_STATUS_META = {
  ...PROJECT_STATUS_META,
  ready: { label: "待交付", i18nKey: "projects.status.ready", color: "cyan" },
};

/**
 * Regular projects follow their rolled-up progress, not a stale planned/active field.
 * Paused/delivered remain explicit business decisions. Ongoing maintenance also
 * follows activity, but 100% does not imply a finite delivery boundary.
 * Pass live progress on the Gantt page to keep the badge and progress bar in sync.
 */
export function projectDisplayStatus(
  project: Pick<Project, "status" | "progress" | "kind" | "hasStartedWork">,
  progress = project.progress,
): ProjectDisplayStatus {
  if (project.status === "paused" || project.status === "done") {
    return project.status;
  }
  if (!Number.isFinite(progress) || progress <= 0) {
    return project.hasStartedWork ? "active" : "planned";
  }
  return progress >= 100 && project.kind !== "ops" ? "ready" : "active";
}

/** Same states as PmProjectActivityRules; summary/milestone are not board tasks. */
export function hasStartedWork(tasks: Pick<Task, "type" | "status">[]): boolean {
  return tasks.some(t => t.type === "task" &&
    (t.status === "in_progress" || t.status === "testing" || t.status === "done"));
}

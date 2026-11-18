/** Default-open trees: remember only explicit collapses. */
export function expandedProjectIds(
  projectIds: string[], collapsedIds: string[]
): string[] {
  const collapsed = new Set(collapsedIds);
  return projectIds.filter((id) => !collapsed.has(id));
}

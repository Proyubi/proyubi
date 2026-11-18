/** Ignore nested controls, not the draggable row's own role="button". */
export function shouldOpenProjectRow(target: EventTarget | null, row: HTMLElement): boolean {
  if (!(target instanceof Element) || !row.contains(target)) return false;
  const control = target.closest("button, a, input, [role='button']");
  return control === null || control === row;
}

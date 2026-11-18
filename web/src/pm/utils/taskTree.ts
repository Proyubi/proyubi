import type { Task } from "../types";

/** Ant Design TreeSelect のノード（バグ⇄タスク紐付けピッカー用）。 */
export interface TaskTreeNode {
  title: string;
  value: string;
  /** 版本（プロジェクト）見出しは選択不可。タスクノードのみ選択可。 */
  selectable?: boolean;
  children?: TaskTreeNode[];
}

/** タスク配列（同一プロジェクト内）を parentId で WBS ツリーへ組む。元の順序を保つ。 */
function buildWbs(tasks: Task[]): TaskTreeNode[] {
  const childrenOf = new Map<string | null, Task[]>();
  for (const tk of tasks) {
    const key = tk.parentId ?? null;
    const arr = childrenOf.get(key);
    if (arr) arr.push(tk);
    else childrenOf.set(key, [tk]);
  }
  const toNode = (tk: Task): TaskTreeNode => {
    const kids = childrenOf.get(tk.id);
    return {
      title: tk.name,
      value: tk.id,
      selectable: true,
      children: kids && kids.length > 0 ? kids.map(toNode) : undefined,
    };
  };
  // 親がロード済みタスクに存在しない場合もルート扱いにする（版本フィルタ跨ぎの取りこぼし防止）。
  const ids = new Set(tasks.map((t) => t.id));
  const roots = tasks.filter((t) => !t.parentId || !ids.has(t.parentId));
  return roots.map(toNode);
}

/**
 * バグ⇄タスク紐付け用の TreeSelect treeData を組む。
 * 版本（プロジェクト）を親、その配下のタスクを WBS ツリーとしてぶら下げる。
 * projects が1件のみなら版本見出しを省いて WBS ルートを直接返す（画面をすっきり）。
 */
export function buildTaskTreeData(
  projects: { id: string; name: string }[],
  tasks: Task[]
): TaskTreeNode[] {
  const tasksOfProject = (pid: string) => tasks.filter((t) => t.projectId === pid);
  if (projects.length <= 1) {
    return buildWbs(projects.length === 1 ? tasksOfProject(projects[0].id) : tasks);
  }
  return projects
    .map((p) => ({
      title: p.name,
      value: `proj:${p.id}`,
      selectable: false,
      children: buildWbs(tasksOfProject(p.id)),
    }))
    // タスクが無い版本は畳んでも意味が薄いので非表示
    .filter((n) => n.children.length > 0);
}

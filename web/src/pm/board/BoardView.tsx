import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useIntl } from "@umijs/max";
import { Avatar, Empty, Progress, Tag, Tooltip } from "antd";
import { useMemo, useState } from "react";
import {
  type Member,
  TASK_STATUS_META,
  TASK_STATUS_ORDER,
  type Task,
  type TaskStatus,
} from "../types";
import { fmt } from "../utils/date";
import { highlightText } from "../utils/highlight";
import "./board.css";

interface Props {
  tasks: Task[];
  memberMap: Record<string, Member>;
  selectedId?: string;
  /** 绞り込み中に残す行 ID（null=絞り込みなし）。ヒットした summary の子孫も含む */
  keepIds?: Set<string> | null;
  /** 実際に名前がヒットした行 ID。カードの強調に使う */
  hitIds?: Set<string>;
  /** ヒット部分を <mark> で囲むキーワード */
  keyword?: string;
  onSelect: (id: string) => void;
  onEdit: (task: Task) => void;
  /** 拖拽到新列 → 更新业务状态（乐观） */
  onStatusChange: (id: string, status: TaskStatus) => void;
}

/** 看板上一张任务卡的内容（拖拽影子与列内复用同一渲染） */
function CardBody({
  task,
  memberMap,
  keyword,
}: {
  task: Task;
  memberMap: Record<string, Member>;
  keyword?: string;
}) {
  const ids = task.assigneeIds ?? [];
  return (
    <>
      <div className="bd-card-name" title={task.name}>
        {highlightText(task.name, keyword)}
      </div>
      {task.levels?.length > 0 && (
        <div className="bd-card-levels">
          {task.levels.map((lv) => (
            <Tag key={lv} className="bd-card-level">
              {lv}
            </Tag>
          ))}
        </div>
      )}
      <div className="bd-card-meta">
        <span className="bd-card-date">
          {fmt(task.start, "MM/DD")} ~ {fmt(task.end, "MM/DD")}
        </span>
        {ids.length > 0 && (
          <Avatar.Group size={20} max={{ count: 3 }}>
            {ids.map((id) => {
              const m = memberMap[id];
              if (!m) return null;
              return (
                <Tooltip key={id} title={m.name}>
                  <Avatar
                    size={20}
                    style={{ background: m.color, fontSize: 10 }}
                  >
                    {m.name.slice(-2)}
                  </Avatar>
                </Tooltip>
              );
            })}
          </Avatar.Group>
        )}
      </div>
      {task.progress > 0 && task.progress < 100 && (
        <Progress
          percent={task.progress}
          size="small"
          showInfo={false}
          strokeColor="#2f6bff"
          className="bd-card-prog"
        />
      )}
    </>
  );
}

/** 可拖拽任务卡 */
function BoardCard({
  task,
  memberMap,
  selected,
  hit,
  keyword,
  onSelect,
  onEdit,
}: {
  task: Task;
  memberMap: Record<string, Member>;
  selected: boolean;
  /** 絞り込みで名前がヒットしたカード（枠を黄色に） */
  hit?: boolean;
  keyword?: string;
  onSelect: (id: string) => void;
  onEdit: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { status: task.status ?? "todo" },
  });
  return (
    <div
      ref={setNodeRef}
      className={`bd-card ${selected ? "bd-card-sel" : ""} ${
        isDragging ? "bd-card-dragging" : ""
      } ${hit ? "bd-card-hit" : ""}`}
      {...listeners}
      {...attributes}
      onClick={() => {
        onSelect(task.id);
        onEdit(task);
      }}
    >
      <CardBody task={task} memberMap={memberMap} keyword={keyword} />
    </div>
  );
}

/** 一列（一个状态） */
function BoardColumn({
  status,
  tasks,
  memberMap,
  selectedId,
  onSelect,
  onEdit,
  label,
  total,
  hitIds,
  keyword,
}: {
  status: TaskStatus;
  tasks: Task[];
  memberMap: Record<string, Member>;
  selectedId?: string;
  onSelect: (id: string) => void;
  onEdit: (task: Task) => void;
  label: string;
  /** 絞り込み前の件数。絞り込み中だけ「3 / 12」と分母を出す */
  total?: number;
  hitIds?: Set<string>;
  keyword?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const meta = TASK_STATUS_META[status];
  return (
    <div className="bd-col">
      <div className="bd-col-head">
        <span className="bd-dot" style={{ background: meta.color }} />
        <span className="bd-col-title">{label}</span>
        <span className="bd-col-count">
          {total !== undefined && total !== tasks.length
            ? `${tasks.length} / ${total}`
            : tasks.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`bd-col-body ${isOver ? "bd-col-over" : ""}`}
      >
        {tasks.map((task) => (
          <BoardCard
            key={task.id}
            task={task}
            memberMap={memberMap}
            selected={selectedId === task.id}
            hit={!!keyword && !!hitIds?.has(task.id)}
            keyword={keyword}
            onSelect={onSelect}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}

export default function BoardView({
  tasks,
  memberMap,
  selectedId,
  keepIds,
  hitIds,
  keyword,
  onSelect,
  onEdit,
  onStatusChange,
}: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  // 看板只展示叶子任务（type==='task'）；summary 为汇总容器、milestone 为时点标记，均不入列
  const allLeaves = useMemo(
    () => tasks.filter((task) => task.type === "task"),
    [tasks]
  );
  // 絞り込み中は keepIds に残ったものだけ。WBS と違い、看板に「祖先の文脈行」は存在しない
  // （summary はそもそも列に入らない）ので、keepIds をそのまま適用してよい。
  const leaves = useMemo(
    () => (keepIds ? allLeaves.filter((task) => keepIds.has(task.id)) : allLeaves),
    [allLeaves, keepIds]
  );
  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      testing: [],
      done: [],
      cancelled: [],
    };
    for (const task of leaves) {
      const s = (task.status ?? "todo") as TaskStatus;
      (map[s] ?? map.todo).push(task);
    }
    return map;
  }, [leaves]);

  // 列ヘッダの分母（絞り込み前）
  const totalByStatus = useMemo(() => {
    const map: Record<string, number> = {};
    for (const task of allLeaves) {
      const s = (task.status ?? "todo") as TaskStatus;
      map[s] = (map[s] ?? 0) + 1;
    }
    return map;
  }, [allLeaves]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    // 拖动需移动 5px 才触发，避免与点击/双击冲突
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const activeTask = activeId
    ? leaves.find((task) => task.id === activeId)
    : undefined;

  const handleStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const handleEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const next = over.id as TaskStatus;
    const cur = (active.data.current?.status ?? "todo") as TaskStatus;
    if (next !== cur) onStatusChange(String(active.id), next);
  };

  if (leaves.length === 0) {
    // 絞り込みで 0 件になった場合は「タスクが無い」ではなく「一致が無い」と言う
    return (
      <div className="bd-empty">
        <Empty
          description={
            keepIds
              ? intl.formatMessage(
                  { id: "projects.gantt.filter.empty" },
                  { kw: keyword?.trim() ?? "" }
                )
              : t("projects.board.empty")
          }
        />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleStart}
      onDragEnd={handleEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="bd-board">
        {TASK_STATUS_ORDER.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={byStatus[status]}
            memberMap={memberMap}
            selectedId={selectedId}
            onSelect={onSelect}
            onEdit={onEdit}
            label={t(TASK_STATUS_META[status].i18nKey)}
            total={keepIds ? totalByStatus[status] ?? 0 : undefined}
            hitIds={hitIds}
            keyword={keyword}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? (
          <div className="bd-card bd-card-overlay">
            <CardBody task={activeTask} memberMap={memberMap} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

import { useMemo } from "react";
import { useIntl } from "@umijs/max";
import { Avatar, Empty, Progress, Spin, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Member, WorkloadItem } from "../types";
import { fmt } from "../utils/date";

interface Props {
  loading: boolean;
  /** 当前筛选条件下的工时条目（与时间轴视图同一份数据源） */
  items: WorkloadItem[];
  /** 成员查找表（渲染担当头像用） */
  members: Member[];
  /** 点击任务行 → 打开编辑 */
  onEditTask?: (item: WorkloadItem) => void;
}

/** 计划起止 → "MM/DD ~ MM/DD"（缺失端补 —） */
function range(
  start: string | null,
  end: string | null,
  t: (s: string) => string
) {
  if (!start && !end) return t("resources.noSchedule");
  const s = start ? fmt(start, "YYYY/MM/DD") : "—";
  const e = end ? fmt(end, "YYYY/MM/DD") : "—";
  return `${s} ~ ${e}`;
}

/**
 * リソースのリスト表示：把当前筛选条件（个人/全员・月窗・隐藏完了）下的任务
 * 以表格形式列出，与时间轴视图共用同一份 items。点击行可编辑。
 */
export default function ResourceListView({
  loading,
  items,
  members,
  onEditTask,
}: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });

  const memberMap = useMemo(() => {
    const m: Record<string, Member> = {};
    for (const it of members) m[it.id] = it;
    return m;
  }, [members]);

  // 列表只展示「任务」种别的叶子：一旦某任务加了子任务，它会升级为 summary 种别，
  // 因此按 type==='task' 过滤即可天然排除上级汇总任务（milestone 也不列）。
  const rows = useMemo(() => items.filter((it) => it.type === "task"), [items]);

  // 担当排序键：取首位成员名（无担当排到最后）
  const assigneeSortKey = (ids: string[]) => {
    if (!ids || ids.length === 0) return "￿";
    return memberMap[ids[0]]?.name ?? ids[0];
  };

  const renderAssignees = (ids: string[]) => {
    if (!ids || ids.length === 0)
      return <span style={{ color: "#bfbfbf" }}>—</span>;
    return (
      <Avatar.Group size="small" max={{ count: 4 }}>
        {ids.map((id) => {
          const m = memberMap[id];
          return (
            <Tooltip key={id} title={m?.name ?? id}>
              <Avatar
                size="small"
                style={{ background: m?.color || "#1677ff" }}
              >
                {(m?.name ?? "?").slice(0, 1)}
              </Avatar>
            </Tooltip>
          );
        })}
      </Avatar.Group>
    );
  };

  const columns: ColumnsType<WorkloadItem> = [
    {
      title: t("resources.col.task"),
      dataIndex: "name",
      ellipsis: true,
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (_, r) => (
        <button
          type="button"
          className="rv-list-taskname"
          onClick={() => onEditTask?.(r)}
          title={t("resources.editTask")}
        >
          {r.type === "milestone" ? "◆ " : ""}
          {r.name}
        </button>
      ),
    },
    {
      title: t("resources.col.project"),
      dataIndex: "projectName",
      width: 260,
      ellipsis: true,
      render: (_, r) => (
        <Tooltip title={`${r.customerName} / ${r.projectName}`}>
          <span style={{ display: "inline-flex", flexDirection: "column" }}>
            <span style={{ fontSize: 12, color: "#8c8c8c", lineHeight: 1.3 }}>
              {r.customerName}
            </span>
            <span style={{ lineHeight: 1.3 }}>{r.projectName}</span>
          </span>
        </Tooltip>
      ),
      sorter: (a, b) =>
        `${a.customerName}${a.projectName}`.localeCompare(
          `${b.customerName}${b.projectName}`
        ),
    },
    {
      title: t("resources.col.assignee"),
      dataIndex: "assigneeIds",
      width: 130,
      sorter: (a, b) =>
        assigneeSortKey(a.assigneeIds).localeCompare(
          assigneeSortKey(b.assigneeIds)
        ),
      render: (_, r) => renderAssignees(r.assigneeIds),
    },
    {
      title: t("resources.col.plan"),
      dataIndex: "start",
      width: 190,
      render: (_, r) => range(r.start, r.end, t),
      sorter: (a, b) => (a.start ?? "").localeCompare(b.start ?? ""),
    },
    {
      title: t("resources.col.actual"),
      dataIndex: "actualStart",
      width: 190,
      sorter: (a, b) =>
        (a.actualStart ?? "").localeCompare(b.actualStart ?? ""),
      render: (_, r) => range(r.actualStart, r.actualEnd, t),
    },
    {
      title: t("resources.col.progress"),
      dataIndex: "progress",
      width: 140,
      render: (_, r) => (
        <Progress
          percent={Math.round(r.progress ?? 0)}
          size="small"
          strokeColor={(r.progress ?? 0) >= 100 ? "#52c41a" : undefined}
        />
      ),
      sorter: (a, b) => (a.progress ?? 0) - (b.progress ?? 0),
    },
  ];

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <Spin />
      </div>
    );
  }

  return (
    <Table<WorkloadItem>
      rowKey="taskId"
      size="middle"
      columns={columns}
      dataSource={rows}
      pagination={{
        defaultPageSize: 20,
        showSizeChanger: true,
        pageSizeOptions: [10, 20, 50, 100],
        showTotal: (total) =>
          intl.formatMessage({ id: "resources.list.total" }, { n: total }),
      }}
      scroll={{ x: "max-content" }}
      locale={{ emptyText: <Empty description={t("resources.empty")} /> }}
    />
  );
}

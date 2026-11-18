import { memo } from "react";
import { useIntl } from "@umijs/max";
import { Avatar, Tooltip, Progress, Dropdown, Select } from "antd";
import {
  CaretRightOutlined,
  CaretDownOutlined,
  FlagFilled,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { highlightText } from "../utils/highlight";
import { effortOf, type EffortAgg, type FlatRow } from "../utils/tree";
import type { Member, Task } from "../types";
import {
  effortFor,
  fmt,
  fmtDuration,
  getHoursPerDay,
  isManualEffort,
} from "../utils/date";
import { GANTT } from "../theme";

interface Props {
  rows: FlatRow[];
  /** summary task -> 后代叶子担当并集（折叠汇总行展示用） */
  assigneeAgg: Map<string, string[]>;
  /** 有子任务的行 -> 后代叶子工期合计（予定/実績）。汇总行の工期列はこの合計を出す */
  effortAgg: Map<string, EffortAgg>;
  memberMap: Record<string, Member>;
  members: Member[];
  /** 红日子（ISO YYYY-MM-DD 集合）：工期列按工作日（排除周末+红日子）显示 */
  holidays?: Set<string>;
  /** footer 総工期・予定合計（分）：後端集計値。前端では再計算しない（null=未取得→0 表示）。 */
  plannedTotal?: number | null;
  /** footer 総工期・実績合計（分）：後端集計値（着手中の手动工期含む）。 */
  actualTotal?: number | null;
  selectedId?: string;
  /** 绞り込みで実際にヒットした行 ID（祖先の文脈行は含まない） */
  hitIds?: Set<string>;
  /** ヒット部分を <mark> で囲むキーワード */
  keyword?: string;
  /** 悬停行 → 通知父级高亮右侧甘特条（进出行时传 id / undefined） */
  onHover?: (id?: string) => void;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onAddChild: (parent: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onAssigneeChange: (taskId: string, assigneeIds: string[]) => void;
}

/** 担当セルに並べる頭像の上限。これを超えた分は「+N」に畳む（列幅が破綻するため） */
const MAX_TAGS = 4;

/**
 * 行内直接选择担当者（多选），下拉比单元格宽，选中项以头像形式展示。
 * summary 行（汇总，担当者只读）也用同一组件渲染（readOnly），
 * 保证与可编辑的叶子行头像左端像素级对齐。
 */
function AssigneeSelect({
  ids,
  members,
  memberMap,
  onChange,
  readOnly = false,
}: {
  ids: string[];
  members: Member[];
  memberMap: Record<string, Member>;
  onChange: (ids: string[]) => void;
  readOnly?: boolean;
}) {
  return (
    <Select
      mode="multiple"
      size="small"
      variant="borderless"
      className={`gt-assignee-select${
        readOnly ? " gt-assignee-select-ro" : ""
      }`}
      placeholder="—"
      value={ids}
      onChange={readOnly ? undefined : onChange}
      open={readOnly ? false : undefined}
      showSearch={!readOnly}
      options={members.map((m) => ({ value: m.id, label: m.name }))}
      optionFilterProp="label"
      popupMatchSelectWidth={false}
      suffixIcon={null}
      removeIcon={readOnly ? null : undefined}
      maxTagCount={MAX_TAGS}
      maxTagPlaceholder={(omitted) => (
        <Tooltip
          title={omitted
            .map((o) => memberMap[o.value as string]?.name)
            .filter(Boolean)
            .join("、")}
        >
          <Avatar
            size={20}
            style={{
              background: "#bfbfbf",
              fontSize: 10,
              border: "1.5px solid #fff",
              marginLeft: -8,
            }}
          >
            +{omitted.length}
          </Avatar>
        </Tooltip>
      )}
      tagRender={({ value, label, isMaxTag }) => {
        // 溢出（+N）项也会走 tagRender（value=undefined / label=maxTagPlaceholder 的内容）。
        // ここで拾わないと「+N」が丸ごと消える。
        if (isMaxTag) return <>{label}</>;
        const m = memberMap[value as string];
        if (!m) return <span />;
        // 重叠显示：第 2 个起内联负边距，往左叠在前一个上（内联样式必生效）
        const idx = ids.indexOf(value as string);
        return (
          <Tooltip title={m.name}>
            <Avatar
              size={20}
              style={{
                background: m.color,
                fontSize: 10,
                border: "1.5px solid #fff",
                marginLeft: idx > 0 ? -8 : 0,
              }}
            >
              {m.name.slice(-2)}
            </Avatar>
          </Tooltip>
        );
      }}
    />
  );
}

/**
 * memo 必須：親（GanttChart）はホバーごとに hoverId で再描画されるが、
 * 左ツリーはホバーに依存しない。memo が無いと毎ホバーで N 行ぶんの
 * Select / Tooltip / Dropdown を作り直し、担当セルのクリック反応が遅れる。
 */
function TaskTreeTable({
  rows,
  assigneeAgg,
  effortAgg,
  memberMap,
  members,
  holidays,
  plannedTotal,
  actualTotal,
  selectedId,
  hitIds,
  keyword,
  onHover,
  onToggle,
  onSelect,
  onAddChild,
  onEdit,
  onDelete,
  onAssigneeChange,
}: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  // 総工期（予定/実績）は後端が全タスクから集計して project に載せてくる（props）。
  // 前端では再計算しない——口径は後端 TaskRollupService.projectEffortTotals に一元化。
  return (
    <div className="gt-tree">
      <div className="gt-tree-head" style={{ height: GANTT.headerHeight }}>
        <div className="gt-col gt-col-name">{t("projects.gantt.col.name")}</div>
        <div className="gt-col gt-col-date">
          {t("projects.gantt.col.start")}
        </div>
        <div className="gt-col gt-col-dur">
          {t("projects.gantt.col.duration")}
        </div>
        <div className="gt-col gt-col-prog">
          {t("projects.gantt.col.progress")}
        </div>
        <div className="gt-col gt-col-people">
          {t("projects.gantt.col.people")}
        </div>
      </div>
      <div className="gt-tree-body">
        {rows.map(({ task, depth, hasChildren }) => {
          const isSummary = task.type === "summary";
          const isMilestone = task.type === "milestone";
          // 進行中：已着手且未完成（里程碑除外），左侧打一个通用橙色圆点
          const isInProgress =
            !isMilestone && task.progress > 0 && task.progress < 100;
          // 編集は「担当」以外のセルにだけ張る。行全体に onClick を張ると、
          // 担当 Select のドロップダウン（body への portal だが React ツリー上は
          // この行の子）のクリックまで拾ってしまい、担当を選ぶたびに編集モーダルが
          // 開く。Select 側で stopPropagation すると今度は rc-select の選択処理
          // 自体が止まるので、そもそも触れないこの形にする。
          const openEdit = () => onEdit(task);
          // 有子の行（汇总）は自身の期間跨度ではなく、后代叶子の工期合計を出す
          const agg = hasChildren ? effortAgg.get(task.id) : undefined;
          return (
            <div
              key={task.id}
              className={`gt-row ${
                selectedId === task.id ? "gt-row-sel" : ""
              } ${isSummary ? "gt-row-summary" : ""} ${
                keyword
                  ? hitIds?.has(task.id)
                    ? "gt-row-hit"
                    : "gt-row-ctx"
                  : ""
              }`}
              style={{ height: GANTT.rowHeight }}
              onMouseEnter={() => onHover?.(task.id)}
              onMouseLeave={() => onHover?.(undefined)}
            >
              <div className="gt-col gt-col-name" onClick={openEdit}>
                {Array.from({ length: depth }, (_, i) => (
                  <span key={i} className="gt-indent" />
                ))}
                {hasChildren ? (
                  <span
                    className="gt-caret"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(task.id);
                    }}
                  >
                    {task.collapsed ? (
                      <CaretRightOutlined />
                    ) : (
                      <CaretDownOutlined />
                    )}
                  </span>
                ) : (
                  <span className="gt-caret-placeholder" />
                )}
                {isMilestone && <FlagFilled className="gt-ms-flag" />}
                {isInProgress && (
                  <Tooltip title={t("projects.board.status.inProgress")}>
                    <span className="gt-progress-dot" />
                  </Tooltip>
                )}
                <span className="gt-name-text" title={task.name}>
                  {highlightText(task.name, keyword)}
                </span>
                <span
                  className="gt-row-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        {
                          key: "add",
                          icon: <PlusOutlined />,
                          label: t("projects.gantt.row.addChild"),
                          onClick: () => onAddChild(task),
                        },
                        {
                          key: "edit",
                          icon: <EditOutlined />,
                          label: t("projects.gantt.row.edit"),
                          onClick: () => onEdit(task),
                        },
                        {
                          key: "del",
                          icon: <DeleteOutlined />,
                          label: t("projects.gantt.row.delete"),
                          danger: true,
                          onClick: () => onDelete(task),
                        },
                      ],
                    }}
                  >
                    <MoreOutlined className="gt-more" />
                  </Dropdown>
                </span>
              </div>
              <div className="gt-col gt-col-date" onClick={openEdit}>
                <Tooltip title={fmt(task.start, "YYYY/MM/DD")}>
                  <span>{fmt(task.start, "MM/DD")}</span>
                </Tooltip>
              </div>
              <div className="gt-col gt-col-dur" onClick={openEdit}>
                {isMilestone ? (
                  "—"
                ) : agg ? (
                  <Tooltip
                    title={
                      <>
                        <div>
                          {intl.formatMessage({
                            id: "gantt.tip.planEffort",
                          })}
                          : {fmtDuration(agg.planned)}
                        </div>
                        {agg.actual > 0 && (
                          <div>
                            {intl.formatMessage({
                              id: "gantt.tip.actualEffort",
                            })}
                            : {fmtDuration(agg.actual)}
                          </div>
                        )}
                      </>
                    }
                  >
                    <span style={{ color: "#2f6bff" }}>
                      {fmtDuration(agg.planned)}
                    </span>
                  </Tooltip>
                ) : (
                  <Tooltip
                    title={
                      <>
                        <div>
                          {intl.formatMessage({
                            id: "gantt.tip.planEffort",
                          })}
                          :{" "}
                          {fmtDuration(
                            effortFor(
                              task.start,
                              task.end,
                              task.plannedEffortDays,
                              task.plannedEffortHours,
                              holidays
                            )
                          )}
                        </div>
                        {((task.actualStart && task.actualEnd) ||
                          isManualEffort(
                            task.actualEffortDays,
                            task.actualEffortHours
                          )) && (
                          <div>
                            {intl.formatMessage({
                              id: "gantt.tip.actualEffort",
                            })}
                            :{" "}
                            {fmtDuration(
                              effortFor(
                                task.actualStart ?? task.start,
                                task.actualEnd ?? task.end,
                                task.actualEffortDays,
                                task.actualEffortHours,
                                holidays
                              )
                            )}
                          </div>
                        )}
                      </>
                    }
                  >
                    <span
                      style={{
                        // 実績套採用（実績期間そろう or 実績工期手动）なら緑、否则予定色
                        color:
                          (task.actualStart && task.actualEnd) ||
                          isManualEffort(
                            task.actualEffortDays,
                            task.actualEffortHours
                          )
                            ? "#52c41a"
                            : "#2f6bff",
                      }}
                    >
                      {fmtDuration(effortOf(task, holidays))}
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="gt-col gt-col-prog" onClick={openEdit}>
                {isMilestone ? (
                  <span className="gt-prog-num">—</span>
                ) : (
                  <>
                    <Progress
                      percent={task.progress}
                      size={[40, 6]}
                      showInfo={false}
                      strokeColor={
                        task.progress === 100 ? "#52c41a" : "#2f6bff"
                      }
                    />
                    <span className="gt-prog-num">{task.progress}%</span>
                  </>
                )}
              </div>
              <div className="gt-col gt-col-people">
                {isSummary && task.collapsed ? (
                  <AssigneeSelect
                    ids={assigneeAgg.get(task.id) ?? []}
                    members={members}
                    memberMap={memberMap}
                    onChange={() => {}}
                    readOnly
                  />
                ) : (
                  <AssigneeSelect
                    ids={task.assigneeIds}
                    members={members}
                    memberMap={memberMap}
                    onChange={(ids) => onAssigneeChange(task.id, ids)}
                    readOnly={isSummary}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="gt-tree-foot" style={{ height: GANTT.rowHeight }}>
        <span className="gt-foot-label">{t("gantt.foot.total")}</span>
        <span className="gt-foot-val gt-foot-planned">
          {t("gantt.foot.planned")} {fmtDuration(plannedTotal ?? 0)}
        </span>
        <span className="gt-foot-val gt-foot-actual">
          {t("gantt.foot.actual")} {fmtDuration(actualTotal ?? 0)}
        </span>
        <span className="gt-foot-note">
          {intl.formatMessage(
            { id: "gantt.foot.note" },
            { hpd: getHoursPerDay() }
          )}
        </span>
      </div>
    </div>
  );
}

export default memo(TaskTreeTable);

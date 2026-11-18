// 甘特图布局常量（组件间共享，保证左右两栏行高对齐）
export const GANTT = {
  rowHeight: 34,
  headerHeight: 56,
  dayWidth: 28,
  weekWidth: 36, // 周视图下每“日”压缩宽度
  barRadius: 4,
} as const;

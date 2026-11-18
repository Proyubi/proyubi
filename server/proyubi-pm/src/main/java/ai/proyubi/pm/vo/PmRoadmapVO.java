package ai.proyubi.pm.vo;

import java.util.List;

/**
 * 路线图 VO（PM）。仅返回项目内 roadmapVisible=true 的（已汇总）条目。
 * start/end/progress 为 summary 汇总后的值（见 TaskRollupService）。
 * options 携带租户级泳道/里程碑色字典（顺序+颜色+标签），供前端数据驱动渲染，
 * 取代前端写死的 LANE_ORDER / 颜色 / i18n 标签。
 *
 */
public record PmRoadmapVO(
    String projectId,
    String projectStart,
    String projectEnd,
    List<RoadmapItem> items,
    RoadmapOptions options
) {

    public record RoadmapItem(
        String id,
        String name,
        String type,
        String start,
        String end,
        int progress,
        String roadmapLane,
        String ownerParty,
        String milestoneColor
    ) {
    }

    /** 路线图字典定义：泳道（已按 sort_order 排序）+ 里程碑色 */
    public record RoadmapOptions(
        List<OptionDef> lanes,
        List<OptionDef> msColors
    ) {
    }

    /** 单个字典项的渲染定义 */
    public record OptionDef(
        String key,
        String label,
        String color,
        int sortOrder
    ) {
    }
}

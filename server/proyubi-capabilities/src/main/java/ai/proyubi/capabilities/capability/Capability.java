package ai.proyubi.capabilities.capability;

/**
 * 能力枚举
 * 定义系统中所有可配置的能力
 *
 */
public enum Capability {
    /**
     * 仓储管理（核心 WMS 功能）
     */
    WAREHOUSE,

    /**
     * 多成员能力
     */
    MULTI_MEMBER,

    /**
     * 项目管理（PM / Gantt・WBS）
     */
    PROJECT_MANAGEMENT,

    /**
     * 记账（管家记账）
     */
    BOOKKEEPING,

    /**
     * 智能分析
     */
    SMART_ANALYTICS,

    /**
     * App定制能力（图标、名称等）
     */
    APP_CUSTOMIZATION,

    /**
     * 协作能力（评论、@提及等）
     */
    COLLABORATION,

    /**
     * 数据导出（CSV / Excel）
     */
    EXPORT
}


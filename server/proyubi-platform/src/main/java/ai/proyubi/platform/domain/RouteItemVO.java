package ai.proyubi.platform.domain;

import lombok.Data;

import java.util.List;

/**
 * 前端路由项 VO（用于菜单接口返回）
 *
 */
@Data
public class RouteItemVO {

    /**
     * 路由路径
     */
    private String path;

    /**
     * 路由名称
     */
    private String name;

    /**
     * 组件路径（字符串）
     */
    private String component;

    /**
     * 路由元信息
     */
    private RouteMetaVO meta;

    /**
     * 子路由
     */
    private List<RouteItemVO> children;

    /**
     * 路由元信息
     */
    @Data
    public static class RouteMetaVO {
        /**
         * 标题（直接使用中文字符串，不需要多语言对象）
         */
        private String title;

        /**
         * 图标
         */
        private String icon;

        /**
         * 排序号
         */
        private Integer orderNo;

        /**
         * 是否隐藏
         */
        private Boolean hidden;
    }
}


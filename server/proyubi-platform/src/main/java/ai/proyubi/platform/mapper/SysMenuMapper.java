package ai.proyubi.platform.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.platform.domain.SysMenu;
import ai.proyubi.common.mybatisflex.typehandler.OffsetDateTimeTypeHandler;
import ai.proyubi.common.mybatisflex.typehandler.UuidTypeHandler;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.type.JdbcType;

import java.util.List;
import java.util.UUID;

/**
 * 菜单 Mapper
 *
 */
@Mapper
public interface SysMenuMapper extends BaseMapper<SysMenu> {
    

    /**
     * 查询指定 App 的菜单（按 app_id 和 audience 过滤）
     */
    @Select("""
        SELECT 
            id,
            menu_name,
            parent_id,
            order_num,
            path,
            component,
            component_name,
            query_param,
            is_frame,
            is_cache,
            menu_type,
            visible,
            status,
            perms,
            icon,
            hidden_expression,
            shop_expression,
            remark,
            app_id,
            audience,
            perm_code,
            created_at,
            updated_at,
            deleted_at
        FROM platform_sys_menu
        WHERE deleted_at IS NULL
          AND (app_id = #{appId, typeHandler=ai.proyubi.common.mybatisflex.typehandler.UuidTypeHandler, jdbcType=OTHER} OR app_id IS NULL)
          AND (audience = #{audience} OR audience IS NULL)
        ORDER BY order_num ASC, created_at ASC NULLS LAST, id ASC
        """)
    @Results({
        @Result(column = "id", property = "id", jdbcType = JdbcType.OTHER, typeHandler = UuidTypeHandler.class),
        @Result(column = "menu_name", property = "menuName", jdbcType = JdbcType.VARCHAR),
        @Result(column = "parent_id", property = "parentId", jdbcType = JdbcType.OTHER, typeHandler = UuidTypeHandler.class),
        @Result(column = "order_num", property = "orderNum", jdbcType = JdbcType.INTEGER),
        @Result(column = "path", property = "path", jdbcType = JdbcType.VARCHAR),
        @Result(column = "component", property = "component", jdbcType = JdbcType.VARCHAR),
        @Result(column = "component_name", property = "componentName", jdbcType = JdbcType.VARCHAR),
        @Result(column = "query_param", property = "queryParam", jdbcType = JdbcType.VARCHAR),
        @Result(column = "is_frame", property = "isFrame", jdbcType = JdbcType.BOOLEAN),
        @Result(column = "is_cache", property = "isCache", jdbcType = JdbcType.BOOLEAN),
        @Result(column = "menu_type", property = "menuType", jdbcType = JdbcType.CHAR),
        @Result(column = "visible", property = "visible", jdbcType = JdbcType.BOOLEAN),
        @Result(column = "status", property = "status", jdbcType = JdbcType.BOOLEAN),
        @Result(column = "perms", property = "perms", jdbcType = JdbcType.VARCHAR),
        @Result(column = "icon", property = "icon", jdbcType = JdbcType.VARCHAR),
        @Result(column = "hidden_expression", property = "hiddenExpression", jdbcType = JdbcType.VARCHAR),
        @Result(column = "shop_expression", property = "shopExpression", jdbcType = JdbcType.VARCHAR),
        @Result(column = "remark", property = "remark", jdbcType = JdbcType.VARCHAR),
        @Result(column = "app_id", property = "appId", jdbcType = JdbcType.OTHER, typeHandler = UuidTypeHandler.class),
        @Result(column = "audience", property = "audience", jdbcType = JdbcType.VARCHAR),
        @Result(column = "perm_code", property = "permCode", jdbcType = JdbcType.VARCHAR),
        @Result(column = "created_at", property = "createdAt", jdbcType = JdbcType.TIMESTAMP, typeHandler = OffsetDateTimeTypeHandler.class),
        @Result(column = "updated_at", property = "updatedAt", jdbcType = JdbcType.TIMESTAMP, typeHandler = OffsetDateTimeTypeHandler.class),
        @Result(column = "deleted_at", property = "deletedAt", jdbcType = JdbcType.TIMESTAMP, typeHandler = OffsetDateTimeTypeHandler.class)
    })
    List<SysMenu> selectMenusByApp(@Param("appId") UUID appId, @Param("audience") String audience);
}


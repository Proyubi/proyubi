package ai.proyubi.platform.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import ai.proyubi.common.mybatisflex.typehandler.OffsetDateTimeTypeHandler;
import ai.proyubi.common.mybatisflex.typehandler.UuidTypeHandler;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.apache.ibatis.type.JdbcType;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 菜单实体
 *
 */
@Data
@NoArgsConstructor
@Table("platform_sys_menu")
public class SysMenu {

    @Id
    @Column(value = "id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID id;

    /**
     * 菜单名称（存储 i18n_key，如 menu.user_management）
     */
    @Column("menu_name")
    private String menuName;

    @Column(value = "parent_id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID parentId;

    @Column("order_num")
    private Integer orderNum;

    private String path;

    private String component;

    @Column("component_name")
    private String componentName;

    @Column("query_param")
    private String queryParam;

    @Column("is_frame")
    private Boolean isFrame;

    @Column("is_cache")
    private Boolean isCache;

    /**
     * 菜单类型（M目录 C菜单 F按钮）
     */
    @Column("menu_type")
    private String menuType;

    private Boolean visible;

    private Boolean status;

    private String perms;

    private String icon;

    @Column("hidden_expression")
    private String hiddenExpression;

    @Column("shop_expression")
    private String shopExpression;

    private String remark;

    @Column(value = "app_id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID appId;

    private String audience;

    @Column("perm_code")
    private String permCode;

    @Column(value = "created_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime createdAt;

    @Column(value = "updated_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime updatedAt;

    @Column(value = "deleted_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime deletedAt;
}


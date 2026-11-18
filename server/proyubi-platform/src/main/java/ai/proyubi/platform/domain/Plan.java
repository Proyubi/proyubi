package ai.proyubi.platform.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import ai.proyubi.common.mybatisflex.typehandler.OffsetDateTimeTypeHandler;
import ai.proyubi.common.mybatisflex.typehandler.PostgreSqlJsonbTypeHandler;
import ai.proyubi.common.mybatisflex.typehandler.UuidTypeHandler;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.apache.ibatis.type.JdbcType;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 套餐实体
 *
 */
@Data
@NoArgsConstructor
@Table("platform_plan")
public class Plan {

    @Id
    @Column(value = "id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID id;

    private String code;

    private String name;

    private String description;

    private BigDecimal price;

    private String currency;

    /**
     * 计费周期（已废弃）
     * @deprecated 计费周期已迁移到 plan_price.interval，一个套餐可以同时有月付和年付价格
     * 保留此字段仅用于数据库兼容，代码中不再使用
     */
    @Deprecated
    @Column("billing_cycle")
    private String billingCycle;

    private String status;

    /**
     * 所属模块（platform_module.code：wms/pm/bk…）。per-module 套餐目录用；
     * 跨模块/历史套餐(如 Plus)可为 null。
     */
    private String module;

    /**
     * 定价页功能列表（JSON 数组字符串）
     * 结构：[{labelKey?:string, label?:string, limit?:string, included:boolean}]
     */
    @Column(typeHandler = PostgreSqlJsonbTypeHandler.class)
    private String features;

    private String remark;

    @Column(value = "created_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime createdAt;

    @Column(value = "updated_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime updatedAt;

    @Column(value = "deleted_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime deletedAt;
}


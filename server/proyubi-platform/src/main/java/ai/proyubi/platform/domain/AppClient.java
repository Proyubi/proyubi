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
 * App 客户端实体
 *
 */
@Data
@NoArgsConstructor
@Table("platform_app_client")
public class AppClient {

    @Id
    @Column(value = "id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID id;

    @Column("app_code")
    private String appCode;

    private String name;

    private String audience;

    /**
     * 所属产品ID（null表示不属于任何产品）
     */
    @Column(value = "product_id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID productId;

    /**
     * OSS 配置ID（null表示使用 Supabase 存储）
     */
    @Column(value = "oss_config_id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID ossConfigId;

    private String status;

    private String remark;

    @Column(value = "created_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime createdAt;

    @Column(value = "updated_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime updatedAt;

    @Column(value = "deleted_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime deletedAt;
}


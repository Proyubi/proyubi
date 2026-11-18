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
 * 能力实体
 *
 */
@Data
@NoArgsConstructor
@Table("platform_capability")
public class Capability {

    @Id
    @Column(value = "id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID id;

    private String code;

    private String name;

    private String description;

    private String status;

    /** 所属模块 code（软引用 platform_module.code）；跨模块能力为 null。 */
    private String module;

    @Column(value = "created_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime createdAt;

    @Column(value = "updated_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime updatedAt;

    @Column(value = "deleted_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime deletedAt;
}


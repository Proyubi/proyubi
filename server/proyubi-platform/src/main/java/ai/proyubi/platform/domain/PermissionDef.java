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
 * 权限点定义实体
 *
 */
@Data
@NoArgsConstructor
@Table("platform_permission_def")
public class PermissionDef {

    @Id
    @Column(value = "id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID id;

    private String code;

    private String name;

    private String type;

    /**
     * 父权限ID（null表示顶级权限，支持多级层级关系）
     */
    @Column(value = "parent_id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID parentId;

    private String remark;

    @Column(value = "created_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime createdAt;

    @Column(value = "updated_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime updatedAt;

    @Column(value = "deleted_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime deletedAt;
}


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

@Data
@NoArgsConstructor
@Table("platform_notice")
public class Notice {

    @Id
    @Column(value = "id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID id;

    @Column("notice_title")
    private String noticeTitle;

    @Column("notice_type")
    private String noticeType;

    @Column("notice_content")
    private String noticeContent;

    private String status;

    private String remark;

    @Column("created_by")
    private String createdBy;

    @Column("updated_by")
    private String updatedBy;

    @Column(value = "created_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime createdAt;

    @Column(value = "updated_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime updatedAt;

    @Column(value = "deleted_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime deletedAt;
}

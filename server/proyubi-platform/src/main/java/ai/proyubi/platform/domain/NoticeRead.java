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
@Table("platform_notice_read")
public class NoticeRead {

    @Id
    @Column(value = "notice_id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID noticeId;

    @Column(value = "user_id", typeHandler = UuidTypeHandler.class, jdbcType = JdbcType.OTHER)
    private UUID userId;

    @Column(value = "read_at", typeHandler = OffsetDateTimeTypeHandler.class, jdbcType = JdbcType.TIMESTAMP)
    private OffsetDateTime readAt;
}

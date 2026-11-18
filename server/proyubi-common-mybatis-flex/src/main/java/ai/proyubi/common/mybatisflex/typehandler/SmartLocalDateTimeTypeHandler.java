package ai.proyubi.common.mybatisflex.typehandler;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedTypes;

import java.sql.*;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;

/**
 * 智能 LocalDateTime 类型处理器（带时区转换）。
 *
 * 解决 PostgreSQL timestamptz 列与 Java LocalDateTime 之间的时区映射问题。
 *
 * 设计约定：
 * - Java 层的 LocalDateTime 统一表示 JVM 本地时间（如 Asia/Tokyo）
 * - PostgreSQL 的 timestamptz 列存储 UTC 时间
 * - 写入时：JVM 本地时间 → 转为 UTC → 发送给 PostgreSQL
 * - 读取时：PostgreSQL 返回 UTC OffsetDateTime → 转为 JVM 本地时间
 *
 * 这样 LocalDateTime.now() 在 Java 中始终返回本地时间，
 * 前端收到的也是本地时间的 ISO 字符串，显示无需再做时区转换。
 *
 */
@MappedTypes(LocalDateTime.class)
public class SmartLocalDateTimeTypeHandler extends BaseTypeHandler<LocalDateTime> {

    private static final ZoneId SYSTEM_ZONE = ZoneId.systemDefault();

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, LocalDateTime parameter, JdbcType jdbcType) throws SQLException {
        // 将 JVM 本地时间转为 UTC 再发送给 PostgreSQL
        // 例如：23:00 JST → 14:00 UTC
        OffsetDateTime utc = parameter.atZone(SYSTEM_ZONE).toOffsetDateTime().withOffsetSameInstant(ZoneOffset.UTC);
        ps.setObject(i, utc);
    }

    @Override
    public LocalDateTime getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return toLocalDateTime(rs.getObject(columnName));
    }

    @Override
    public LocalDateTime getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return toLocalDateTime(rs.getObject(columnIndex));
    }

    @Override
    public LocalDateTime getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return toLocalDateTime(cs.getObject(columnIndex));
    }

    private LocalDateTime toLocalDateTime(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof OffsetDateTime) {
            // timestamptz → OffsetDateTime(UTC) → 转为 JVM 本地时间
            // 例如：14:00 UTC → 23:00 JST
            return ((OffsetDateTime) value).atZoneSameInstant(SYSTEM_ZONE).toLocalDateTime();
        }
        if (value instanceof LocalDateTime) {
            return (LocalDateTime) value;
        }
        if (value instanceof Timestamp) {
            return ((Timestamp) value).toLocalDateTime();
        }
        throw new IllegalArgumentException("Cannot convert " + value.getClass().getName() + " to LocalDateTime");
    }
}

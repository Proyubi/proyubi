package ai.proyubi.common.mybatisflex.typehandler;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import java.sql.*;
import java.time.OffsetDateTime;

/**
 * PostgreSQL TIMESTAMPTZ 到 OffsetDateTime 的类型处理器
 * 
 * PostgreSQL JDBC 驱动 42.2+ 版本已经原生支持 OffsetDateTime，
 * 但为了确保兼容性，我们使用 getObject/setObject 方法
 *
 */
public class OffsetDateTimeTypeHandler extends BaseTypeHandler<OffsetDateTime> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, OffsetDateTime parameter, JdbcType jdbcType) throws SQLException {
        // PostgreSQL JDBC 驱动原生支持 OffsetDateTime
        ps.setObject(i, parameter);
    }

    @Override
    public OffsetDateTime getNullableResult(ResultSet rs, String columnName) throws SQLException {
        // 使用 getObject 方法，PostgreSQL JDBC 驱动会自动转换为 OffsetDateTime
        Object value = rs.getObject(columnName, OffsetDateTime.class);
        if (value == null) {
            return null;
        }
        if (value instanceof OffsetDateTime) {
            return (OffsetDateTime) value;
        }
        // 如果返回的是 Timestamp，转换为 OffsetDateTime
        if (value instanceof Timestamp) {
            return ((Timestamp) value).toInstant().atOffset(java.time.ZoneOffset.UTC);
        }
        return null;
    }

    @Override
    public OffsetDateTime getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        Object value = rs.getObject(columnIndex, OffsetDateTime.class);
        if (value == null) {
            return null;
        }
        if (value instanceof OffsetDateTime) {
            return (OffsetDateTime) value;
        }
        if (value instanceof Timestamp) {
            return ((Timestamp) value).toInstant().atOffset(java.time.ZoneOffset.UTC);
        }
        return null;
    }

    @Override
    public OffsetDateTime getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        Object value = cs.getObject(columnIndex, OffsetDateTime.class);
        if (value == null) {
            return null;
        }
        if (value instanceof OffsetDateTime) {
            return (OffsetDateTime) value;
        }
        if (value instanceof Timestamp) {
            return ((Timestamp) value).toInstant().atOffset(java.time.ZoneOffset.UTC);
        }
        return null;
    }
}


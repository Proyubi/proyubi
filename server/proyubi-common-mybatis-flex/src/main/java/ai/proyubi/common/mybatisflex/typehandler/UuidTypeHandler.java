package ai.proyubi.common.mybatisflex.typehandler;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import java.sql.*;
import java.util.UUID;

/**
 * PostgreSQL UUID 类型处理器
 * 
 * PostgreSQL JDBC 驱动原生支持 UUID，但为了确保兼容性，我们使用 getObject/setObject 方法
 *
 */
public class UuidTypeHandler extends BaseTypeHandler<UUID> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, UUID parameter, JdbcType jdbcType) throws SQLException {
        // PostgreSQL JDBC 驱动原生支持 UUID
        ps.setObject(i, parameter);
    }

    @Override
    public UUID getNullableResult(ResultSet rs, String columnName) throws SQLException {
        // 使用 getObject 方法，PostgreSQL JDBC 驱动会自动转换为 UUID
        Object value = rs.getObject(columnName);
        if (value == null) {
            return null;
        }
        if (value instanceof UUID) {
            return (UUID) value;
        }
        // 如果返回的是 String，转换为 UUID
        if (value instanceof String) {
            return UUID.fromString((String) value);
        }
        // 如果返回的是其他类型，尝试转换为字符串再解析
        return UUID.fromString(value.toString());
    }

    @Override
    public UUID getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        Object value = rs.getObject(columnIndex);
        if (value == null) {
            return null;
        }
        if (value instanceof UUID) {
            return (UUID) value;
        }
        if (value instanceof String) {
            return UUID.fromString((String) value);
        }
        return UUID.fromString(value.toString());
    }

    @Override
    public UUID getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        Object value = cs.getObject(columnIndex);
        if (value == null) {
            return null;
        }
        if (value instanceof UUID) {
            return (UUID) value;
        }
        if (value instanceof String) {
            return UUID.fromString((String) value);
        }
        return UUID.fromString(value.toString());
    }
}


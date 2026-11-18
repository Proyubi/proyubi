package ai.proyubi.common.mybatisflex.typehandler;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import java.sql.*;

/**
 * PostgreSQL jsonb 列到 Java String 的类型处理器。
 *
 * 解决 MyBatis 将 Java String 作为 varchar 发送给 PostgreSQL，
 * 导致 jsonb 列写入失败的问题（PostgreSQL 不自动将 varchar 转为 jsonb）。
 *
 * 写入时：通过 setObject(i, value, Types.OTHER) 让 PG 驱动将值作为
 *         服务器端类型处理，从而正确写入 jsonb 列
 * 读取时：直接作为 String 返回
 *
 */
public class PostgreSqlJsonbTypeHandler extends BaseTypeHandler<String> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, String parameter, JdbcType jdbcType) throws SQLException {
        // Types.OTHER 让 PostgreSQL JDBC 驱动将值按服务器端列类型处理
        ps.setObject(i, parameter, Types.OTHER);
    }

    @Override
    public String getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return rs.getString(columnName);
    }

    @Override
    public String getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return rs.getString(columnIndex);
    }

    @Override
    public String getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return cs.getString(columnIndex);
    }
}

package ai.proyubi.common.mybatisflex.typehandler;

import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;

import java.sql.*;
import java.util.ArrayList;
import java.util.List;

/**
 * PostgreSQL text[] 数组到 List<String> 的类型处理器
 *
 */
public class PostgreSqlStringArrayTypeHandler extends BaseTypeHandler<List<String>> {

    @Override
    public void setNonNullParameter(PreparedStatement ps, int i, List<String> parameter, JdbcType jdbcType) throws SQLException {
        Array array = ps.getConnection().createArrayOf("text", parameter.toArray());
        ps.setArray(i, array);
    }

    @Override
    public List<String> getNullableResult(ResultSet rs, String columnName) throws SQLException {
        return parseArray(rs.getArray(columnName));
    }

    @Override
    public List<String> getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
        return parseArray(rs.getArray(columnIndex));
    }

    @Override
    public List<String> getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
        return parseArray(cs.getArray(columnIndex));
    }

    private List<String> parseArray(Array array) throws SQLException {
        if (array == null) {
            return new ArrayList<>();
        }
        Object[] arrayResult = (Object[]) array.getArray();
        List<String> result = new ArrayList<>();
        if (arrayResult != null) {
            for (Object obj : arrayResult) {
                if (obj != null) {
                    result.add(obj.toString());
                }
            }
        }
        return result;
    }
}


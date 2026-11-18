package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmMcpToken;
import org.apache.ibatis.annotations.Mapper;

/**
 * PM MCP 个人连接令牌 Mapper。
 *
 */
@Mapper
public interface PmMcpTokenMapper extends BaseMapper<PmMcpToken> {
}

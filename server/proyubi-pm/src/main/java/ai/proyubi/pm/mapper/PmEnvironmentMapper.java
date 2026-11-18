package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmEnvironment;
import org.apache.ibatis.annotations.Mapper;

/**
 * 環境マスタ Mapper（品質管理）
 *
 */
@Mapper
public interface PmEnvironmentMapper extends BaseMapper<PmEnvironment> {
}

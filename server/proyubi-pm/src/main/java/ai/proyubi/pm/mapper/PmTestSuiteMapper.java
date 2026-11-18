package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmTestSuite;
import org.apache.ibatis.annotations.Mapper;

/**
 * テストスイート Mapper（品質管理）
 *
 */
@Mapper
public interface PmTestSuiteMapper extends BaseMapper<PmTestSuite> {
}

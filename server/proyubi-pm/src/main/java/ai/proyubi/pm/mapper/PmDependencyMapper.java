package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmDependency;
import org.apache.ibatis.annotations.Mapper;

/**
 * 任务依赖Mapper（PM）
 *
 */
@Mapper
public interface PmDependencyMapper extends BaseMapper<PmDependency> {
}

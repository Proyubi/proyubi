package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmTask;
import org.apache.ibatis.annotations.Mapper;

/**
 * 任务Mapper（PM）
 *
 */
@Mapper
public interface PmTaskMapper extends BaseMapper<PmTask> {
}

package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmDocTask;
import org.apache.ibatis.annotations.Mapper;

/**
 * 资料↔任务 对应关系Mapper（PM）
 *
 */
@Mapper
public interface PmDocTaskMapper extends BaseMapper<PmDocTask> {
}

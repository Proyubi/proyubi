package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmProject;
import org.apache.ibatis.annotations.Mapper;

/**
 * 项目/版本Mapper（PM）
 *
 */
@Mapper
public interface PmProjectMapper extends BaseMapper<PmProject> {
}

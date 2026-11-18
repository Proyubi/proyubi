package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmTaskLink;
import org.apache.ibatis.annotations.Mapper;

/**
 * 任务关联链接Mapper（PM）
 *
 */
@Mapper
public interface PmTaskLinkMapper extends BaseMapper<PmTaskLink> {
}

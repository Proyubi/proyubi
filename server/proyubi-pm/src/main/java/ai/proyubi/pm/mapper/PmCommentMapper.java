package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmComment;
import org.apache.ibatis.annotations.Mapper;

/**
 * 任务评论Mapper（PM）
 *
 */
@Mapper
public interface PmCommentMapper extends BaseMapper<PmComment> {
}

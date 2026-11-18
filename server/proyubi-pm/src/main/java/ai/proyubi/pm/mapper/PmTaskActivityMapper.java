package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmTaskActivity;
import org.apache.ibatis.annotations.Mapper;

/**
 * タスク操作履歴Mapper（PM）
 *
 */
@Mapper
public interface PmTaskActivityMapper extends BaseMapper<PmTaskActivity> {
}

package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmEvent;
import org.apache.ibatis.annotations.Mapper;

/**
 * 事件/会议日程Mapper（PM）。
 * 经 ProyubiApplication 既有 {@code @MapperScan(ai.proyubi.pm.mapper)} 自动注册。
 *
 */
@Mapper
public interface PmEventMapper extends BaseMapper<PmEvent> {
}

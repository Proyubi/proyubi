package ai.proyubi.pm.mapper;

import ai.proyubi.pm.domain.PmSetting;
import com.mybatisflex.core.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

/**
 * PM 租户级设置 Mapper。
 *
 */
@Mapper
public interface PmSettingMapper extends BaseMapper<PmSetting> {
}

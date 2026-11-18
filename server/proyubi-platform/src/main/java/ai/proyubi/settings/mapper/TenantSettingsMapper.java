package ai.proyubi.settings.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.settings.domain.TenantSettings;
import org.apache.ibatis.annotations.Mapper;

/**
 * 租户业务配置Mapper（Core Domain）
 *
 */
@Mapper
public interface TenantSettingsMapper extends BaseMapper<TenantSettings> {
}

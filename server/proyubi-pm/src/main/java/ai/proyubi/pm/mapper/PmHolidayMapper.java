package ai.proyubi.pm.mapper;

import ai.proyubi.pm.domain.PmHoliday;
import com.mybatisflex.core.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.UUID;

/**
 * 节假日 Mapper（PM）。
 *
 */
@Mapper
public interface PmHolidayMapper extends BaseMapper<PmHoliday> {

    /** 列出全部租户 id（定时同步遍历用；避免引入 ops 模块重依赖） */
    @Select("select id from platform_tenant where deleted_at is null")
    List<UUID> listAllTenantIds();
}

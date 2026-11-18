package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmCustomer;
import org.apache.ibatis.annotations.Mapper;

/**
 * 客户/产品Mapper（PM）
 *
 */
@Mapper
public interface PmCustomerMapper extends BaseMapper<PmCustomer> {
}

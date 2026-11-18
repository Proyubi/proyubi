package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmMember;
import org.apache.ibatis.annotations.Mapper;

/**
 * 团队成员Mapper（PM）
 *
 */
@Mapper
public interface PmMemberMapper extends BaseMapper<PmMember> {
}

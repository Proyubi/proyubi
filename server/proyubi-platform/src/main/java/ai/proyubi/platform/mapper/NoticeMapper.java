package ai.proyubi.platform.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.platform.domain.Notice;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface NoticeMapper extends BaseMapper<Notice> {
}

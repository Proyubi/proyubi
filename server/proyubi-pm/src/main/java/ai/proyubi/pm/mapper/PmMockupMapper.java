package ai.proyubi.pm.mapper;

import ai.proyubi.pm.domain.PmMockup;
import com.mybatisflex.core.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

import java.util.UUID;

/**
 * モックアップMapper（PM）
 *
 */
@Mapper
public interface PmMockupMapper extends BaseMapper<PmMockup> {

    /** 共有リンクの閲覧を 1 回記録（同時アクセスでも取りこぼさないよう DB 側で加算）。 */
    @Update("""
        update pm_mockup
           set share_view_count = share_view_count + 1,
               share_last_viewed_at = now()
         where id = #{id}
        """)
    int incrementShareView(@Param("id") UUID id);
}

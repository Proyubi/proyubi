package ai.proyubi.platform.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.platform.domain.NoticeRead;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.UUID;

@Mapper
public interface NoticeReadMapper extends BaseMapper<NoticeRead> {

    @Insert("INSERT INTO platform_notice_read (notice_id, user_id, read_at) " +
            "VALUES (#{noticeId}::uuid, #{userId}::uuid, now()) " +
            "ON CONFLICT (notice_id, user_id) DO NOTHING")
    void markAsRead(@Param("noticeId") UUID noticeId, @Param("userId") UUID userId);

    @Insert("INSERT INTO platform_notice_read (notice_id, user_id, read_at) " +
            "SELECT n.id, #{userId}::uuid, now() " +
            "FROM platform_notice n " +
            "WHERE n.status = 'ACTIVE' AND n.deleted_at IS NULL " +
            "AND n.id NOT IN (SELECT nr.notice_id FROM platform_notice_read nr WHERE nr.user_id = #{userId}::uuid) " +
            "ON CONFLICT (notice_id, user_id) DO NOTHING")
    int markAllAsRead(@Param("userId") UUID userId);

    @Select("SELECT COUNT(*) FROM platform_notice n " +
            "WHERE n.status = 'ACTIVE' AND n.deleted_at IS NULL " +
            "AND n.id NOT IN (SELECT nr.notice_id FROM platform_notice_read nr WHERE nr.user_id = #{userId}::uuid)")
    int countUnread(@Param("userId") UUID userId);

    @Select("SELECT notice_id FROM platform_notice_read WHERE user_id = #{userId}::uuid")
    List<UUID> selectReadNoticeIds(@Param("userId") UUID userId);
}

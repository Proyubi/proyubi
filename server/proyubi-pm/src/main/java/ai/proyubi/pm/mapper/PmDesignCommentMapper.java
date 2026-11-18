package ai.proyubi.pm.mapper;

import ai.proyubi.pm.domain.PmDesignComment;
import com.mybatisflex.core.BaseMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

import java.time.LocalDateTime;

import java.util.List;
import java.util.UUID;

/**
 * 設計審査コメントMapper
 *
 */
@Mapper
public interface PmDesignCommentMapper extends BaseMapper<PmDesignComment> {

    /** 本文編集と解決操作は別の列だけを書く。削除済みコメントは復活させない。 */
    @Update("""
        update pm_design_comment set body = #{body}, updated_at = now()
         where tenant_id = #{tenantId} and id = #{id}
           and author_user_id = #{userId} and deleted_at is null
        """)
    int editBody(@Param("tenantId") UUID tenantId, @Param("id") UUID id,
                 @Param("userId") UUID userId, @Param("body") String body);

    @Update("""
        update pm_design_comment
           set resolved = #{resolved}, resolved_by = #{resolvedBy},
               resolved_by_name = #{resolvedByName}, resolved_at = #{resolvedAt}, updated_at = now()
         where tenant_id = #{tenantId} and id = #{id} and deleted_at is null
        """)
    int setResolved(@Param("tenantId") UUID tenantId, @Param("id") UUID id,
                    @Param("resolved") boolean resolved, @Param("resolvedBy") UUID resolvedBy,
                    @Param("resolvedByName") String resolvedByName,
                    @Param("resolvedAt") LocalDateTime resolvedAt);

    @Update("""
        update pm_design_comment set deleted_at = now(), updated_at = now()
         where tenant_id = #{tenantId} and id = #{id}
           and author_user_id = #{userId} and deleted_at is null
        """)
    int softDelete(@Param("tenantId") UUID tenantId, @Param("id") UUID id,
                   @Param("userId") UUID userId);

    /** 設計の未削除コメント（revision 指定時はその修訂のみ）。古い順。 */
    default List<PmDesignComment> selectLive(UUID tenantId, UUID designId, Integer revision) {
        QueryWrapper q = QueryWrapper.create()
            .where(PmDesignComment::getTenantId).eq(tenantId)
            .and(PmDesignComment::getDesignId).eq(designId)
            .and(PmDesignComment::getDeletedAt).isNull();
        if (revision != null) {
            q.and(PmDesignComment::getRevision).eq(revision);
        }
        return selectListByQuery(q.orderBy(PmDesignComment::getCreatedAt, true));
    }
}

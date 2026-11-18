package ai.proyubi.pm.mapper;

import ai.proyubi.pm.domain.PmDesignFrame;
import com.mybatisflex.core.BaseMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.UUID;

/**
 * .pen 画框Mapper
 *
 */
@Mapper
public interface PmDesignFrameMapper extends BaseMapper<PmDesignFrame> {

    /** 保存時の同期：名前・並び順・最終修訂だけを書く（審査ステータスは保持）。消えていた画框は復活させる。 */
    @Insert("""
        insert into pm_design_frame (id, tenant_id, design_id, node_id, name, sort_order, last_revision)
        values (gen_random_uuid(), #{tenantId}, #{designId}, #{nodeId}, #{name}, #{sortOrder}, #{revision})
        on conflict (design_id, node_id) do update
           set name = excluded.name, sort_order = excluded.sort_order,
               last_revision = excluded.last_revision, removed = false, updated_at = now()
        """)
    int upsertSeen(@Param("tenantId") UUID tenantId, @Param("designId") UUID designId,
                   @Param("nodeId") String nodeId, @Param("name") String name,
                   @Param("sortOrder") int sortOrder, @Param("revision") int revision);

    /** 今回の修訂に無かった画框を removed にする（行・ステータス・紐付けは残す）。 */
    @Update("""
        update pm_design_frame set removed = true, updated_at = now()
         where tenant_id = #{tenantId} and design_id = #{designId}
           and last_revision < #{revision} and removed = false
        """)
    int markMissingRemoved(@Param("tenantId") UUID tenantId, @Param("designId") UUID designId,
                           @Param("revision") int revision);

    @Update("""
        update pm_design_frame
           set review_status = #{status}, status_by = #{userId}, status_by_name = #{userName},
               status_at = now(), updated_at = now()
         where tenant_id = #{tenantId} and design_id = #{designId} and node_id = #{nodeId}
        """)
    int setStatus(@Param("tenantId") UUID tenantId, @Param("designId") UUID designId,
                  @Param("nodeId") String nodeId, @Param("status") String status,
                  @Param("userId") UUID userId, @Param("userName") String userName);

    /** 設計の全画框（removed 含む）。原文の並び順。 */
    default List<PmDesignFrame> selectByDesign(UUID tenantId, UUID designId) {
        return selectListByQuery(QueryWrapper.create()
            .where(PmDesignFrame::getTenantId).eq(tenantId)
            .and(PmDesignFrame::getDesignId).eq(designId)
            .orderBy(PmDesignFrame::getSortOrder, true));
    }

    /** 複数設計の画框（一覧の集計用）。 */
    default List<PmDesignFrame> selectByDesigns(UUID tenantId, List<UUID> designIds) {
        if (designIds.isEmpty()) {
            return List.of();
        }
        return selectListByQuery(QueryWrapper.create()
            .where(PmDesignFrame::getTenantId).eq(tenantId)
            .and(PmDesignFrame::getDesignId).in(designIds));
    }

    default PmDesignFrame selectOne(UUID tenantId, UUID designId, String nodeId) {
        return selectOneByQuery(QueryWrapper.create()
            .where(PmDesignFrame::getTenantId).eq(tenantId)
            .and(PmDesignFrame::getDesignId).eq(designId)
            .and(PmDesignFrame::getNodeId).eq(nodeId));
    }
}

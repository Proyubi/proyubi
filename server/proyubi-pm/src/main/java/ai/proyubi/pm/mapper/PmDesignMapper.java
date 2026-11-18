package ai.proyubi.pm.mapper;

import ai.proyubi.pm.domain.PmDesign;
import com.mybatisflex.core.BaseMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.UUID;

/**
 * 設計資産Mapper（PM Design Studio）
 *
 */
@Mapper
public interface PmDesignMapper extends BaseMapper<PmDesign> {

    /**
     * 修訂の CAS 前進。current_revision が expected のときだけ next に進め、更新者と Git 由来メタを書く。
     * 戻り値 0 = 他の保存が先に進めた / 削除済み / 他租户 → 呼び出し側で 409。
     * 手書き SQL なので租户条件を明示する（TenantManager は効かない）。
     * source_* は null を渡すと既存値を保つ。
     */
    @Update("""
        update pm_design
           set current_revision = #{next},
               updated_by = #{userId},
               updated_by_name = #{userName},
               updated_at = now(),
               source_repo = coalesce(#{sourceRepo}, source_repo),
               source_ref = coalesce(#{sourceRef}, source_ref),
               source_path = coalesce(#{sourcePath}, source_path),
               source_commit_sha = coalesce(#{sourceCommitSha}, source_commit_sha),
               source_hash = coalesce(#{sourceHash}, source_hash)
         where tenant_id = #{tenantId}
           and id = #{id}
           and current_revision = #{expected}
           and deleted_at is null
        """)
    int advanceRevision(@Param("tenantId") UUID tenantId, @Param("id") UUID id,
                        @Param("expected") int expected, @Param("next") int next,
                        @Param("userId") UUID userId, @Param("userName") String userName,
                        @Param("sourceRepo") String sourceRepo, @Param("sourceRef") String sourceRef,
                        @Param("sourcePath") String sourcePath, @Param("sourceCommitSha") String sourceCommitSha,
                        @Param("sourceHash") String sourceHash);

    /** メタ編集は修訂番号・由来メタ・削除状態を書き戻さない。 */
    @Update("""
        update pm_design
           set title = coalesce(#{title}, title),
               task_id = case when #{changeTask} then #{taskId} else task_id end,
               updated_by = #{userId}, updated_by_name = #{userName}, updated_at = now()
         where tenant_id = #{tenantId} and id = #{id} and deleted_at is null
        """)
    int updateMetaFields(@Param("tenantId") UUID tenantId, @Param("id") UUID id,
                         @Param("title") String title, @Param("changeTask") boolean changeTask,
                         @Param("taskId") UUID taskId, @Param("userId") UUID userId,
                         @Param("userName") String userName);

    /** 軟削除も最新修訂や他の列を古い読み取りスナップショットで上書きしない。 */
    @Update("""
        update pm_design set deleted_at = now(), updated_at = now()
         where tenant_id = #{tenantId} and id = #{id} and deleted_at is null
        """)
    int softDelete(@Param("tenantId") UUID tenantId, @Param("id") UUID id);

    /** 案件（taskId 指定時はそのタスク）の未削除設計。更新が新しい順。 */
    default List<PmDesign> selectLive(UUID tenantId, UUID projectId, UUID taskId) {
        QueryWrapper q = QueryWrapper.create()
            .where(PmDesign::getTenantId).eq(tenantId)
            .and(PmDesign::getDeletedAt).isNull();
        if (taskId != null) {
            q.and(PmDesign::getTaskId).eq(taskId);
        } else {
            q.and(PmDesign::getProjectId).eq(projectId);
        }
        return selectListByQuery(q.orderBy(PmDesign::getUpdatedAt, false));
    }
}

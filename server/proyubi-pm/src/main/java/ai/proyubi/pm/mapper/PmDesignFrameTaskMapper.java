package ai.proyubi.pm.mapper;

import ai.proyubi.pm.domain.PmDesignFrameTask;
import com.mybatisflex.core.BaseMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.UUID;

/**
 * 画框 ⇄ タスク紐付けMapper
 *
 */
@Mapper
public interface PmDesignFrameTaskMapper extends BaseMapper<PmDesignFrameTask> {

    /** 既に紐付いていれば何もしない（0 件）。 */
    @Insert("""
        insert into pm_design_frame_task (id, tenant_id, design_id, node_id, task_id, created_by, created_by_name)
        values (gen_random_uuid(), #{tenantId}, #{designId}, #{nodeId}, #{taskId}, #{userId}, #{userName})
        on conflict (design_id, node_id, task_id) do nothing
        """)
    int link(@Param("tenantId") UUID tenantId, @Param("designId") UUID designId, @Param("nodeId") String nodeId,
             @Param("taskId") UUID taskId, @Param("userId") UUID userId, @Param("userName") String userName);

    @Delete("""
        delete from pm_design_frame_task
         where tenant_id = #{tenantId} and design_id = #{designId} and node_id = #{nodeId} and task_id = #{taskId}
        """)
    int unlink(@Param("tenantId") UUID tenantId, @Param("designId") UUID designId, @Param("nodeId") String nodeId,
               @Param("taskId") UUID taskId);

    default List<PmDesignFrameTask> selectByDesign(UUID tenantId, UUID designId) {
        return selectListByQuery(QueryWrapper.create()
            .where(PmDesignFrameTask::getTenantId).eq(tenantId)
            .and(PmDesignFrameTask::getDesignId).eq(designId)
            .orderBy(PmDesignFrameTask::getCreatedAt, true));
    }

    default List<PmDesignFrameTask> selectByTask(UUID tenantId, UUID taskId) {
        return selectListByQuery(QueryWrapper.create()
            .where(PmDesignFrameTask::getTenantId).eq(tenantId)
            .and(PmDesignFrameTask::getTaskId).eq(taskId)
            .orderBy(PmDesignFrameTask::getCreatedAt, true));
    }
}

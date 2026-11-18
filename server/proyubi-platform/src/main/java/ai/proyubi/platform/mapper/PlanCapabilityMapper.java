package ai.proyubi.platform.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 套餐-能力关联 Mapper
 *
 */
@Mapper
public interface PlanCapabilityMapper {

    /**
     * 根据套餐 ID 查询能力列表（含状态和限额）
     */
    @Select("""
        SELECT
            c.id,
            c.code,
            c.name,
            c.description,
            pc.status,
            pc.limit_json::text AS limit_json
        FROM platform_plan_capability pc
        INNER JOIN platform_capability c ON pc.capability_id = c.id
        WHERE pc.plan_id = #{planId}
          AND c.deleted_at IS NULL
        ORDER BY c.code
        """)
    List<Map<String, Object>> selectCapabilitiesByPlanId(@Param("planId") UUID planId);

    /**
     * 根据套餐代码查询能力列表（含状态和限额）
     */
    @Select("""
        SELECT
            c.id,
            c.code,
            c.name,
            c.description,
            pc.status,
            pc.limit_json::text AS limit_json
        FROM platform_plan_capability pc
        INNER JOIN platform_capability c ON pc.capability_id = c.id
        INNER JOIN platform_plan p ON pc.plan_id = p.id
        WHERE p.code = #{planCode}
          AND p.deleted_at IS NULL
          AND c.deleted_at IS NULL
        ORDER BY c.code
        """)
    List<Map<String, Object>> selectCapabilitiesByPlanCode(@Param("planCode") String planCode);

    /**
     * 删除套餐的所有能力关联
     */
    @Delete("DELETE FROM platform_plan_capability WHERE plan_id = #{planId}")
    int deleteByPlanId(@Param("planId") UUID planId);

    /**
     * 插入套餐-能力关联
     */
    @Insert("""
        INSERT INTO platform_plan_capability (plan_id, capability_id, status, limit_json, created_at, updated_at)
        VALUES (
            #{planId, typeHandler=ai.proyubi.common.mybatisflex.typehandler.UuidTypeHandler, jdbcType=OTHER},
            #{capabilityId, typeHandler=ai.proyubi.common.mybatisflex.typehandler.UuidTypeHandler, jdbcType=OTHER},
            #{status},
            #{limitJson}::jsonb,
            NOW(),
            NOW()
        )
        """)
    int insert(@Param("planId") UUID planId,
               @Param("capabilityId") UUID capabilityId,
               @Param("status") String status,
               @Param("limitJson") String limitJson);
}

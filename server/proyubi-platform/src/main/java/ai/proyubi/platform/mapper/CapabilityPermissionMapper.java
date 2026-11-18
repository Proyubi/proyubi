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
 * 能力-权限关联 Mapper
 *
 */
@Mapper
public interface CapabilityPermissionMapper {

    /**
     * 根据能力 ID 列表查询权限代码列表
     */
    @Select("""
        <script>
        SELECT DISTINCT pd.code
        FROM platform_capability_permission cp
        INNER JOIN platform_permission_def pd ON cp.permission_id = pd.id
        WHERE cp.capability_id IN
        <foreach collection="capabilityIds" item="capId" open="(" separator="," close=")">
          #{capId, typeHandler=ai.proyubi.common.mybatisflex.typehandler.UuidTypeHandler, jdbcType=OTHER}
        </foreach>
          AND pd.deleted_at IS NULL
        </script>
        """)
    List<String> selectPermissionCodesByCapabilityIds(@Param("capabilityIds") List<UUID> capabilityIds);

    /**
     * 根据能力 ID 查询关联的权限列表（含权限详情）
     */
    @Select("""
        SELECT pd.id, pd.code, pd.name, pd.type
        FROM platform_capability_permission cp
        INNER JOIN platform_permission_def pd ON cp.permission_id = pd.id
        WHERE cp.capability_id = #{capabilityId}
          AND pd.deleted_at IS NULL
        ORDER BY pd.code
        """)
    List<Map<String, Object>> selectPermissionsByCapabilityId(@Param("capabilityId") UUID capabilityId);

    /**
     * 删除能力的所有权限关联
     */
    @Delete("DELETE FROM platform_capability_permission WHERE capability_id = #{capabilityId}")
    int deleteByCapabilityId(@Param("capabilityId") UUID capabilityId);

    /**
     * 插入能力-权限关联
     */
    @Insert("""
        INSERT INTO platform_capability_permission (capability_id, permission_id, created_at)
        VALUES (
            #{capabilityId, typeHandler=ai.proyubi.common.mybatisflex.typehandler.UuidTypeHandler, jdbcType=OTHER},
            #{permissionId, typeHandler=ai.proyubi.common.mybatisflex.typehandler.UuidTypeHandler, jdbcType=OTHER},
            NOW()
        )
        """)
    int insert(@Param("capabilityId") UUID capabilityId, @Param("permissionId") UUID permissionId);
}

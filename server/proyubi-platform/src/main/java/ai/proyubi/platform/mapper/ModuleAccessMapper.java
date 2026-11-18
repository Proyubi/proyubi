package ai.proyubi.platform.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.UUID;

/**
 * 模块准入网关（freee 模型 A）所需的只读查询。
 *
 * <p>落在已扫描包 {@code ai.proyubi.platform.mapper}（proyubi-server 依赖 ops，ops 在
 * {@code @MapperScan} 内），供 {@code ModuleAccessInterceptor} 在请求级判断准入。
 */
@Mapper
public interface ModuleAccessMapper {

    /**
     * 该(租户,用户)在某模块是否有有效 grant（活跃 + 未软删）。返回命中条数（0/1）。
     */
    @Select("""
        SELECT count(*) FROM platform_module_grant
        WHERE tenant_id = #{tenantId} AND tenant_user_id = #{userId}
          AND module = #{module} AND status = 'active' AND deleted_at IS NULL
    """)
    int countActiveGrant(@Param("tenantId") UUID tenantId,
                         @Param("userId") UUID userId,
                         @Param("module") String module);

    /**
     * 查询用户在租户内的角色（owner/member…）。owner 网关绕过用，防漏发 grant 锁死事業所主。
     */
    @Select("""
        SELECT role FROM platform_tenant_user
        WHERE id = #{userId} AND tenant_id = #{tenantId} AND deleted_at IS NULL
    """)
    String findTenantRole(@Param("tenantId") UUID tenantId, @Param("userId") UUID userId);

    /**
     * 该租户在某模块是否有活跃订阅（订阅网关用）。返回命中条数（0/1，受活跃唯一索引保证）。
     * 「开通」口径＝存在 status='active' 的订阅行（FREE 行亦算已开通）。
     */
    @Select("""
        SELECT count(*) FROM platform_subscription
        WHERE tenant_id = #{tenantId} AND module = #{module} AND status = 'active'
    """)
    int countActiveSubscription(@Param("tenantId") UUID tenantId, @Param("module") String module);
}

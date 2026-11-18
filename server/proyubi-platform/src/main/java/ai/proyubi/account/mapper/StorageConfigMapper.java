package ai.proyubi.account.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.Map;

/**
 * 存储配置只读 Mapper
 * <p>
 * 直接查询 platform_app_client + platform_oss_config 表，
 * 避免 WMS 模块对 OPS 模块产生 Maven 依赖（OPS 已依赖 WMS，反向会循环）。
 *
 */
@Mapper
public interface StorageConfigMapper {

    /**
     * 根据 appCode 查询关联的 OSS 配置
     *
     * @param appCode App 代码，如 "user-web-cn"
     * @return OSS 配置信息（Map），若 appClient 不存在或未关联 ossConfig 则返回 null
     */
    @Select("""
        SELECT oc.id, oc.config_key, oc.endpoint, oc.access_key, oc.secret_key,
               oc.bucket_name, oc.custom_domain, oc.prefix, oc.is_https,
               oc.region, oc.bucket_policy, oc.create_bucket, oc.updated_at
        FROM platform_app_client ac
        JOIN platform_oss_config oc ON oc.id = ac.oss_config_id AND oc.deleted_at IS NULL
        WHERE ac.app_code = #{appCode}
          AND ac.deleted_at IS NULL
          AND ac.status = 'active'
          AND oc.status = 'active'
    """)
    Map<String, Object> findOssConfigByAppCode(@Param("appCode") String appCode);

    /**
     * 查询默认 OSS 配置（is_default=true）。
     * <p>
     * appClient 没绑定 ossConfig 时的兜底，比 Supabase 优先。
     * ux_oss_config_key 只保证 config_key 唯一，is_default 没有唯一约束，
     * 所以这里显式 limit 1（按 updated_at 取最近改的那条）。
     *
     * @return OSS 配置信息（Map），没有默认配置则返回 null
     */
    @Select("""
        SELECT oc.id, oc.config_key, oc.endpoint, oc.access_key, oc.secret_key,
               oc.bucket_name, oc.custom_domain, oc.prefix, oc.is_https,
               oc.region, oc.bucket_policy, oc.create_bucket, oc.updated_at
        FROM platform_oss_config oc
        WHERE oc.is_default = true
          AND oc.status = 'active'
          AND oc.deleted_at IS NULL
        ORDER BY oc.updated_at DESC
        LIMIT 1
    """)
    Map<String, Object> findDefaultOssConfig();
}

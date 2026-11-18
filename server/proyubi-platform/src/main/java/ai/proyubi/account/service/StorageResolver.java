package ai.proyubi.account.service;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.account.mapper.StorageConfigMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 存储选择器
 * <p>
 * 根据当前请求的 appCode 选择对应的存储后端：
 * - appClient 关联了 ossConfig → S3StorageService（MinIO/S3）
 * - 未关联或找不到 → SupabaseStorageService（兜底）
 * <p>
 * S3StorageService 实例按 ossConfigId + updatedAt 缓存，
 * 配置变更后下次请求自动重建客户端，无需重启。
 *
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StorageResolver {

    private final StorageConfigMapper storageConfigMapper;
    private final SupabaseStorageService supabaseStorageService;

    /** 缓存: ossConfigId → CachedS3Service */
    private final ConcurrentHashMap<UUID, CachedS3Service> s3Cache = new ConcurrentHashMap<>();

    // ---- 委托方法 ----

    public String upload(UUID tenantId, String subfolder, String filename,
                         String contentType, byte[] fileBytes) {
        S3StorageService s3 = resolveS3();
        if (s3 != null) {
            return s3.upload(tenantId, subfolder, filename, contentType, fileBytes);
        }
        return supabaseStorageService.upload(tenantId, subfolder, filename, contentType, fileBytes);
    }

    public void deleteByPublicUrl(String publicUrl) {
        S3StorageService s3 = resolveS3();
        if (s3 != null) {
            s3.deleteByPublicUrl(publicUrl);
        } else {
            supabaseStorageService.deleteByPublicUrl(publicUrl);
        }
    }

    public void deleteAllByPublicUrls(List<String> publicUrls) {
        S3StorageService s3 = resolveS3();
        if (s3 != null) {
            s3.deleteAllByPublicUrls(publicUrls);
        } else {
            supabaseStorageService.deleteAllByPublicUrls(publicUrls);
        }
    }

    // ---- 内部逻辑 ----

    /**
     * 解析当前请求应使用的 S3 存储服务。
     * <p>
     * 顺序：appClient 绑定的 ossConfig → is_default 的 ossConfig → null（走 Supabase）。
     * 中间那层 default 兜底是 2026-08-26 加的：在此之前没绑定就直接落 Supabase，
     * 而 Supabase 项目被删后这条路是死的（域名 NXDOMAIN），线上四个 appClient 全没绑定
     * → 所有上传静默失败。默认配置指向自建 MinIO，新建 appClient 忘了绑也不会再掉进死路。
     */
    private S3StorageService resolveS3() {
        return resolveS3ByAppCode(TenantContext.getAppCode());
    }

    private S3StorageService resolveS3ByAppCode(String appCode) {
        Map<String, Object> config = null;

        if (appCode != null && !appCode.isBlank()) {
            try {
                config = storageConfigMapper.findOssConfigByAppCode(appCode);
            } catch (Exception e) {
                log.warn("查询 OSS 配置失败, appCode={}", appCode, e);
            }
        }

        if (config == null) {
            try {
                config = storageConfigMapper.findDefaultOssConfig();
            } catch (Exception e) {
                log.warn("查询默认 OSS 配置失败, appCode={}", appCode, e);
            }
            if (config == null) {
                log.warn("appCode={} 未绑定 OSS 配置，且没有 is_default 的配置，回落 Supabase", appCode);
                return null;
            }
        }

        UUID configId = toUUID(config.get("id"));
        if (configId == null) {
            return null;
        }

        // 检查缓存是否有效（比对 updatedAt）
        OffsetDateTime updatedAt = toOffsetDateTime(config.get("updatedAt"));
        CachedS3Service cached = s3Cache.get(configId);
        if (cached != null && cached.isValid(updatedAt)) {
            return cached.service;
        }

        // 构建新的 S3StorageService
        try {
            S3StorageService service = buildS3Service(config);
            s3Cache.put(configId, new CachedS3Service(service, updatedAt));
            log.info("已创建/更新 S3 存储客户端: configId={}, appCode={}", configId, appCode);
            return service;
        } catch (Exception e) {
            log.error("创建 S3 存储客户端失败: configId={}", configId, e);
            return null;
        }
    }

    private S3StorageService buildS3Service(Map<String, Object> config) {
        String endpoint = (String) config.get("endpoint");
        String accessKey = (String) config.get("accessKey");
        String secretKey = (String) config.get("secretKey");
        String bucketName = (String) config.get("bucketName");
        String customDomain = (String) config.get("customDomain");
        String prefix = (String) config.get("prefix");
        Boolean isHttps = toBoolean(config.get("isHttps"));
        String region = (String) config.get("region");
        Boolean createBucket = toBoolean(config.get("createBucket"));
        String bucketPolicy = (String) config.get("bucketPolicy");

        return new S3StorageService(
            endpoint, accessKey, secretKey, bucketName,
            prefix, customDomain,
            isHttps != null ? isHttps : true,
            region,
            createBucket != null ? createBucket : false,
            bucketPolicy
        );
    }

    // ---- 类型转换辅助 ----

    private static UUID toUUID(Object obj) {
        if (obj instanceof UUID u) return u;
        if (obj instanceof String s) return UUID.fromString(s);
        return null;
    }

    private static OffsetDateTime toOffsetDateTime(Object obj) {
        if (obj instanceof OffsetDateTime odt) return odt;
        if (obj instanceof java.sql.Timestamp ts) return ts.toInstant().atOffset(java.time.ZoneOffset.UTC);
        return null;
    }

    private static Boolean toBoolean(Object obj) {
        if (obj instanceof Boolean b) return b;
        return null;
    }

    /** 缓存条目 */
    private record CachedS3Service(S3StorageService service, OffsetDateTime updatedAt) {
        boolean isValid(OffsetDateTime currentUpdatedAt) {
            if (updatedAt == null || currentUpdatedAt == null) return false;
            return updatedAt.equals(currentUpdatedAt);
        }
    }
}

package ai.proyubi.account.service;

import ai.proyubi.common.core.exception.BizException;
import io.minio.*;
import io.minio.errors.ErrorResponseException;
import lombok.extern.slf4j.Slf4j;

import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.UUID;

/**
 * S3 兼容存储服务（基于 MinIO SDK）
 * <p>
 * 支持 MinIO、AWS S3、阿里云 OSS（S3 兼容模式）等。
 * 每个实例绑定一组 OssConfig 参数，由 StorageResolver 按需创建和缓存。
 *
 */
@Slf4j
public class S3StorageService {

    private final MinioClient minioClient;
    private final String bucketName;
    private final String prefix;
    private final String baseUrl;

    /**
     * @param endpoint     S3 端点（如 http://localhost:9000）
     * @param accessKey    访问密钥
     * @param secretKey    秘密密钥
     * @param bucketName   桶名称
     * @param prefix       对象键前缀（可为 null）
     * @param customDomain 自定义域名（可为 null，优先用于生成公开 URL）
     * @param isHttps      是否使用 HTTPS（影响生成的 URL 协议）
     * @param region       区域（可为 null）
     * @param createBucket 是否自动创建桶
     * @param bucketPolicy 桶策略（public 时自动设置公读）
     */
    public S3StorageService(String endpoint, String accessKey, String secretKey,
                            String bucketName, String prefix, String customDomain,
                            boolean isHttps, String region, boolean createBucket,
                            String bucketPolicy) {
        MinioClient.Builder builder = MinioClient.builder()
            .endpoint(endpoint)
            .credentials(accessKey, secretKey);
        if (region != null && !region.isBlank()) {
            builder.region(region);
        }
        this.minioClient = builder.build();
        this.bucketName = bucketName;
        this.prefix = (prefix != null && !prefix.isBlank()) ? prefix : null;

        // 计算公开访问基础 URL
        if (customDomain != null && !customDomain.isBlank()) {
            String domain = customDomain.trim();
            if (!domain.startsWith("http://") && !domain.startsWith("https://")) {
                domain = (isHttps ? "https://" : "http://") + domain;
            }
            this.baseUrl = domain.endsWith("/") ? domain : domain + "/";
        } else {
            String ep = endpoint.trim();
            if (!ep.startsWith("http://") && !ep.startsWith("https://")) {
                ep = (isHttps ? "https://" : "http://") + ep;
            }
            ep = ep.endsWith("/") ? ep : ep + "/";
            this.baseUrl = ep + bucketName + "/";
        }

        // 自动创建桶
        if (createBucket) {
            ensureBucket(bucketPolicy);
        }
    }

    /**
     * 上传文件
     *
     * @return 公开访问 URL
     */
    public String upload(UUID tenantId, String subfolder, String filename,
                         String contentType, byte[] fileBytes) {
        String objectKey = buildObjectKey(tenantId, subfolder, filename);

        try (ByteArrayInputStream is = new ByteArrayInputStream(fileBytes)) {
            minioClient.putObject(PutObjectArgs.builder()
                .bucket(bucketName)
                .object(objectKey)
                .stream(is, fileBytes.length, -1)
                .contentType(contentType)
                .build());
        } catch (Exception e) {
            log.error("S3 上传失败: bucket={}, key={}", bucketName, objectKey, e);
            throw BizException.of(500, "文件上传失败");
        }

        return baseUrl + objectKey;
    }

    /**
     * 根据公开 URL 删除文件
     */
    public void deleteByPublicUrl(String publicUrl) {
        if (publicUrl == null || publicUrl.isBlank()) {
            return;
        }
        String objectKey = extractObjectKey(publicUrl);
        if (objectKey == null) {
            log.warn("无法从 URL 解析 S3 对象键: {}", publicUrl);
            return;
        }

        try {
            minioClient.removeObject(RemoveObjectArgs.builder()
                .bucket(bucketName)
                .object(objectKey)
                .build());
        } catch (Exception e) {
            log.warn("S3 删除失败: bucket={}, key={}", bucketName, objectKey, e);
        }
    }

    /**
     * 批量删除文件
     */
    public void deleteAllByPublicUrls(List<String> publicUrls) {
        if (publicUrls == null || publicUrls.isEmpty()) {
            return;
        }
        for (String url : publicUrls) {
            deleteByPublicUrl(url);
        }
    }

    private String buildObjectKey(UUID tenantId, String subfolder, String filename) {
        StringBuilder sb = new StringBuilder();
        if (prefix != null) {
            sb.append(prefix);
            if (!prefix.endsWith("/")) {
                sb.append("/");
            }
        }
        sb.append(tenantId).append("/").append(subfolder).append("/").append(filename);
        return sb.toString();
    }

    /**
     * 从公开 URL 中提取 objectKey
     */
    private String extractObjectKey(String publicUrl) {
        if (publicUrl.startsWith(baseUrl)) {
            return publicUrl.substring(baseUrl.length());
        }
        // 尝试从 URL 路径中提取（兼容不同的 URL 格式）
        int bucketIdx = publicUrl.indexOf("/" + bucketName + "/");
        if (bucketIdx >= 0) {
            return publicUrl.substring(bucketIdx + bucketName.length() + 2);
        }
        return null;
    }

    private void ensureBucket(String bucketPolicy) {
        try {
            boolean exists = minioClient.bucketExists(
                BucketExistsArgs.builder().bucket(bucketName).build());
            if (!exists) {
                minioClient.makeBucket(
                    MakeBucketArgs.builder().bucket(bucketName).build());
                log.info("已创建 S3 桶: {}", bucketName);

                // 设置公读策略
                if ("public".equals(bucketPolicy)) {
                    String policy = """
                        {
                          "Version": "2012-10-17",
                          "Statement": [{
                            "Effect": "Allow",
                            "Principal": {"AWS": ["*"]},
                            "Action": ["s3:GetObject"],
                            "Resource": ["arn:aws:s3:::%s/*"]
                          }]
                        }
                        """.formatted(bucketName);
                    minioClient.setBucketPolicy(
                        SetBucketPolicyArgs.builder()
                            .bucket(bucketName)
                            .config(policy)
                            .build());
                    log.info("已设置 S3 桶公读策略: {}", bucketName);
                }
            }
        } catch (ErrorResponseException e) {
            log.warn("检查/创建 S3 桶失败（可能权限不足，忽略）: {}", e.getMessage());
        } catch (Exception e) {
            log.warn("检查/创建 S3 桶异常: {}", e.getMessage(), e);
        }
    }
}

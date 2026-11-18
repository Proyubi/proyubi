package ai.proyubi.account.service;

import ai.proyubi.common.core.exception.BizException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.UUID;

/**
 * Supabase Storage 文件上传服务
 */
@Slf4j
@Service
public class SupabaseStorageService {

    @Value("${supabase.url}")
    private String supabaseUrl;

    @Value("${supabase.service-role-key}")
    private String serviceRoleKey;

    @Value("${supabase.storage.bucket:product-images}")
    private String bucket;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    /**
     * 上传文件到 Supabase Storage
     *
     * @param tenantId    租户 ID
     * @param filename    文件名（如 uuid.jpg）
     * @param contentType MIME 类型
     * @param fileBytes   文件内容
     * @return 公开访问 URL
     */
    public String upload(UUID tenantId, String subfolder, String filename, String contentType, byte[] fileBytes) {
        String objectPath = tenantId + "/" + subfolder + "/" + filename;
        String uploadUrl = supabaseUrl + "/storage/v1/object/" + bucket + "/" + objectPath;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(uploadUrl))
            .header("Authorization", "Bearer " + serviceRoleKey)
            .header("Content-Type", contentType)
            .header("x-upsert", "true")
            .POST(HttpRequest.BodyPublishers.ofByteArray(fileBytes))
            .build();

        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.error("Supabase Storage upload failed: status={}, body={}", response.statusCode(), response.body());
                throw BizException.of(500, "文件上传失败");
            }
        } catch (BizException e) {
            throw e;
        } catch (Exception e) {
            log.error("Supabase Storage upload error", e);
            throw BizException.of(500, "文件上传失败");
        }

        return supabaseUrl + "/storage/v1/object/public/" + bucket + "/" + objectPath;
    }

    /**
     * 从 Supabase Storage 删除文件
     *
     * @param publicUrl 文件的公开访问URL
     */
    public void deleteByPublicUrl(String publicUrl) {
        if (publicUrl == null || publicUrl.isBlank()) {
            return;
        }
        String prefix = supabaseUrl + "/storage/v1/object/public/" + bucket + "/";
        if (!publicUrl.startsWith(prefix)) {
            log.warn("Cannot parse Supabase object path from URL: {}", publicUrl);
            return;
        }
        String objectPath = publicUrl.substring(prefix.length());

        String deleteUrl = supabaseUrl + "/storage/v1/object/" + bucket;
        String jsonBody = "{\"prefixes\":[\"" + objectPath.replace("\"", "\\\"") + "\"]}";

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(deleteUrl))
            .header("Authorization", "Bearer " + serviceRoleKey)
            .header("Content-Type", "application/json")
            .method("DELETE", HttpRequest.BodyPublishers.ofString(jsonBody))
            .build();

        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.warn("Supabase Storage delete failed: status={}, body={}, path={}",
                    response.statusCode(), response.body(), objectPath);
            }
        } catch (Exception e) {
            log.warn("Supabase Storage delete error for path={}", objectPath, e);
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
}

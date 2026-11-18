package ai.proyubi.account.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.settings.domain.TenantSettingsConfig;
import ai.proyubi.settings.service.TenantSettingsService;
import ai.proyubi.account.service.StorageResolver;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.UUID;

/**
 * App 图标上传 Controller
 * 原子操作：删旧 → 传新 → 更新设置
 */
@RestController
@RequestMapping("/app/settings/app-icon")
@RequiredArgsConstructor
public class AppIconController {

    private final StorageResolver storageResolver;
    private final TenantSettingsService tenantSettingsService;

    private static final long MAX_SIZE = 500 * 1024; // 500KB
    private static final String SUBFOLDER = "app-icon";

    /**
     * 上传或替换 App 图标
     */
    @PostMapping
    public R<String> uploadAppIcon(@RequestParam("file") MultipartFile file) {
        UUID tenantId = getTenantId();

        if (file.isEmpty()) {
            throw BizException.of(400, "文件不能为空");
        }
        if (file.getSize() > MAX_SIZE) {
            throw BizException.of(400, "文件大小不能超过 500KB");
        }
        String contentType = file.getContentType();
        if (!"image/png".equals(contentType)) {
            throw BizException.of(400, "App 图标仅支持 PNG 格式");
        }

        byte[] fileBytes;
        try {
            fileBytes = file.getBytes();
        } catch (IOException e) {
            throw BizException.of(500, "文件读取失败");
        }

        // 删除旧图标
        TenantSettingsConfig config = tenantSettingsService.getSettings(tenantId);
        if (config.getAppIconUrl() != null && !config.getAppIconUrl().isBlank()) {
            storageResolver.deleteByPublicUrl(config.getAppIconUrl());
        }

        // 上传新图标
        String filename = UUID.randomUUID() + ".png";
        String url = storageResolver.upload(tenantId, SUBFOLDER, filename, contentType, fileBytes);

        // 更新设置
        tenantSettingsService.updateSettings(tenantId,
                "{\"appIconUrl\":\"" + url.replace("\"", "\\\"") + "\"}");

        return R.ok(url);
    }

    /**
     * 删除 App 图标
     */
    @DeleteMapping
    public R<Void> deleteAppIcon() {
        UUID tenantId = getTenantId();

        TenantSettingsConfig config = tenantSettingsService.getSettings(tenantId);
        if (config.getAppIconUrl() != null && !config.getAppIconUrl().isBlank()) {
            storageResolver.deleteByPublicUrl(config.getAppIconUrl());
        }

        tenantSettingsService.updateSettings(tenantId, "{\"appIconUrl\":null}");
        return R.ok(null);
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }
}

package ai.proyubi.settings.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.settings.domain.TenantSettings;
import ai.proyubi.settings.domain.TenantSettingsConfig;
import ai.proyubi.settings.mapper.TenantSettingsMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 租户业务配置Service（Core Domain）
 * 注意：tenantId 仅作为数据过滤条件，Core Domain 不关心租户业务
 *
 */
@Service
public class TenantSettingsService {

    private final TenantSettingsMapper settingsMapper;
    private final ObjectMapper objectMapper;

    public TenantSettingsService(TenantSettingsMapper settingsMapper, ObjectMapper objectMapper) {
        this.settingsMapper = settingsMapper;
        this.objectMapper = objectMapper;
    }

    /**
     * 获取租户配置（合并默认值）
     * DB 无记录时返回全默认值
     *
     * @param tenantId 租户ID（仅用于数据隔离）
     */
    public TenantSettingsConfig getSettings(UUID tenantId) {
        TenantSettings entity = getEntityByTenant(tenantId);
        if (entity == null || entity.getSettings() == null || entity.getSettings().isBlank()) {
            return new TenantSettingsConfig();
        }
        return deserialize(entity.getSettings());
    }

    /**
     * 更新租户配置（partial merge）
     * 前端传入的 JSON 只包含要修改的字段，与现有配置合并
     *
     * @param tenantId    租户ID（仅用于数据隔离）
     * @param partialJson 部分配置 JSON
     */
    @Transactional
    public TenantSettingsConfig updateSettings(UUID tenantId, String partialJson) {
        // 读取当前配置
        TenantSettingsConfig current = getSettings(tenantId);

        // 将 partial JSON merge 到当前配置上
        try {
            objectMapper.readerForUpdating(current).readValue(partialJson);
        } catch (JsonProcessingException e) {
            throw BizException.of(400, "配置格式不正确");
        }

        // 序列化回 JSON
        String settingsJson = serialize(current);

        // upsert
        TenantSettings entity = getEntityByTenant(tenantId);
        if (entity == null) {
            entity = new TenantSettings();
            entity.setId(UUID.randomUUID());
            entity.setTenantId(tenantId);
            entity.setSettings(settingsJson);
            entity.setCreatedAt(LocalDateTime.now());
            entity.setUpdatedAt(LocalDateTime.now());
            settingsMapper.insert(entity);
        } else {
            entity.setSettings(settingsJson);
            entity.setUpdatedAt(LocalDateTime.now());
            settingsMapper.update(entity);
        }

        return current;
    }

    private TenantSettings getEntityByTenant(UUID tenantId) {
        return settingsMapper.selectOneByQuery(
            QueryWrapper.create()
                .where(TenantSettings::getTenantId).eq(tenantId)
                .limit(1)
        );
    }

    private TenantSettingsConfig deserialize(String json) {
        try {
            return objectMapper.readValue(json, TenantSettingsConfig.class);
        } catch (JsonProcessingException e) {
            // JSON 损坏时返回默认值，不阻断业务
            return new TenantSettingsConfig();
        }
    }

    private String serialize(TenantSettingsConfig config) {
        try {
            return objectMapper.writeValueAsString(config);
        } catch (JsonProcessingException e) {
            throw BizException.of(500, "配置序列化失败");
        }
    }
}

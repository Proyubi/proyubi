package ai.proyubi.settings.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.settings.domain.ProductField;
import ai.proyubi.settings.domain.TenantSettingsConfig;
import ai.proyubi.settings.domain.TransactionField;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 字段可见性 Service
 *
 * 模型：每个字段在代码中定义默认可见性，租户可对单字段设置覆盖（override）。
 * 有效可见性 = 默认值 + 租户覆盖。
 *
 */
@Service
public class FieldVisibilityService {

    public static final String ENTITY_PRODUCT = "product";
    public static final String ENTITY_TRANSACTION = "transaction";

    private final TenantSettingsService tenantSettingsService;
    private final ObjectMapper objectMapper;

    public FieldVisibilityService(TenantSettingsService tenantSettingsService,
                                  ObjectMapper objectMapper) {
        this.tenantSettingsService = tenantSettingsService;
        this.objectMapper = objectMapper;
    }

    /**
     * 取产品实体的有效字段可见性（按枚举声明顺序）
     */
    public Map<String, Boolean> getProductVisibility(UUID tenantId) {
        Map<String, Boolean> overrides = entityOverrides(tenantId, ENTITY_PRODUCT);
        Map<String, Boolean> map = new LinkedHashMap<>();
        for (ProductField field : ProductField.values()) {
            String key = toCamel(field.name());
            Boolean override = overrides.get(key);
            map.put(key, override != null ? override : field.isDefaultVisible());
        }
        return map;
    }

    /**
     * 取出入库记录实体的有效字段可见性（按枚举声明顺序）
     */
    public Map<String, Boolean> getTransactionVisibility(UUID tenantId) {
        Map<String, Boolean> overrides = entityOverrides(tenantId, ENTITY_TRANSACTION);
        Map<String, Boolean> map = new LinkedHashMap<>();
        for (TransactionField field : TransactionField.values()) {
            String key = toCamel(field.name());
            Boolean override = overrides.get(key);
            map.put(key, override != null ? override : field.isDefaultVisible());
        }
        return map;
    }

    /**
     * 单字段可见性更新（true/false 写覆盖；null 清除覆盖回到默认值）
     */
    @Transactional
    public void setFieldVisibility(UUID tenantId, String entity, String field, Boolean visible) {
        if (!isKnownField(entity, field)) {
            throw BizException.of(400, "未知的字段: " + entity + "." + field);
        }

        TenantSettingsConfig current = tenantSettingsService.getSettings(tenantId);
        Map<String, Map<String, Boolean>> overrides = current.getFieldOverrides();
        if (overrides == null) {
            overrides = new LinkedHashMap<>();
        }
        Map<String, Boolean> entityMap = overrides.computeIfAbsent(entity, k -> new LinkedHashMap<>());
        if (visible == null) {
            entityMap.remove(field);
        } else {
            entityMap.put(field, visible);
        }
        current.setFieldOverrides(overrides);

        // 整体覆盖写回（partial merge 对 Map 是 replace 语义，传完整 fieldOverrides 才能正确生效）
        try {
            String partial = "{\"fieldOverrides\":" + objectMapper.writeValueAsString(overrides) + "}";
            tenantSettingsService.updateSettings(tenantId, partial);
        } catch (JsonProcessingException e) {
            throw BizException.of(500, "字段可见性序列化失败");
        }
    }

    /**
     * 产品实体的字段元信息（顺序与枚举一致）
     */
    public Map<String, String> productFieldLabels() {
        Map<String, String> map = new LinkedHashMap<>();
        for (ProductField field : ProductField.values()) {
            map.put(toCamel(field.name()), field.getLabel());
        }
        return map;
    }

    /**
     * 出入库记录实体的字段元信息（顺序与枚举一致）
     */
    public Map<String, String> transactionFieldLabels() {
        Map<String, String> map = new LinkedHashMap<>();
        for (TransactionField field : TransactionField.values()) {
            map.put(toCamel(field.name()), field.getLabel());
        }
        return map;
    }

    private boolean isKnownField(String entity, String field) {
        if (ENTITY_PRODUCT.equals(entity)) {
            for (ProductField f : ProductField.values()) {
                if (toCamel(f.name()).equals(field)) return true;
            }
            return false;
        }
        if (ENTITY_TRANSACTION.equals(entity)) {
            for (TransactionField f : TransactionField.values()) {
                if (toCamel(f.name()).equals(field)) return true;
            }
            return false;
        }
        return false;
    }

    private Map<String, Boolean> entityOverrides(UUID tenantId, String entity) {
        TenantSettingsConfig config = tenantSettingsService.getSettings(tenantId);
        Map<String, Map<String, Boolean>> all = config.getFieldOverrides();
        if (all == null) return Map.of();
        Map<String, Boolean> entityMap = all.get(entity);
        return entityMap != null ? entityMap : Map.of();
    }

    /**
     * 枚举名 SCREAMING_SNAKE → 小驼峰，与前端字段命名对齐
     */
    private static String toCamel(String upperSnake) {
        String[] parts = upperSnake.toLowerCase().split("_");
        StringBuilder sb = new StringBuilder(parts[0]);
        for (int i = 1; i < parts.length; i++) {
            String p = parts[i];
            if (p.isEmpty()) continue;
            sb.append(Character.toUpperCase(p.charAt(0))).append(p.substring(1));
        }
        return sb.toString();
    }
}

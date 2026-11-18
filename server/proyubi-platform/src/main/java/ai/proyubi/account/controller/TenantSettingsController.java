package ai.proyubi.account.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.settings.domain.TenantSettingsConfig;
import ai.proyubi.settings.service.FieldVisibilityService;
import ai.proyubi.settings.service.TenantSettingsService;
import jakarta.validation.constraints.NotBlank;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 租户业务配置Controller
 *
 */
@RestController
@RequestMapping("/app/settings")
@Validated
public class TenantSettingsController {

    private static final String ENTITY_PRODUCT = "product";
    private static final String ENTITY_TRANSACTION = "transaction";

    private final TenantSettingsService tenantSettingsService;
    private final FieldVisibilityService fieldVisibilityService;

    public TenantSettingsController(TenantSettingsService tenantSettingsService,
                                       FieldVisibilityService fieldVisibilityService) {
        this.tenantSettingsService = tenantSettingsService;
        this.fieldVisibilityService = fieldVisibilityService;
    }

    /**
     * 获取租户配置（合并默认值后的完整配置）
     */
    @GetMapping
    public R<TenantSettingsConfig> getSettings() {
        UUID tenantId = getTenantId();
        TenantSettingsConfig config = tenantSettingsService.getSettings(tenantId);
        return R.ok(config);
    }

    /**
     * 更新租户配置（partial merge，只传要修改的字段）
     */
    @PutMapping
    public R<TenantSettingsConfig> updateSettings(@RequestBody String partialJson) {
        UUID tenantId = getTenantId();
        TenantSettingsConfig config = tenantSettingsService.updateSettings(tenantId, partialJson);
        return R.ok(config);
    }

    /**
     * 获取字段可见性
     * 按实体分组返回字段列表，每个字段含 name/label/visible
     */
    @GetMapping("/field-visibility")
    public R<FieldVisibilityResp> getFieldVisibility() {
        return R.ok(buildResp(getTenantId()));
    }

    /**
     * 单字段可见性更新
     * visible 为 null 时清除该字段的覆盖（回到默认值）
     */
    @PutMapping("/field-visibility")
    public R<FieldVisibilityResp> setFieldVisibility(@RequestBody SetFieldVisibilityReq req) {
        if (req == null) {
            throw BizException.of(400, "请求体不能为空");
        }
        UUID tenantId = getTenantId();
        fieldVisibilityService.setFieldVisibility(tenantId, req.entity(), req.field(), req.visible());
        return R.ok(buildResp(tenantId));
    }

    private FieldVisibilityResp buildResp(UUID tenantId) {
        Map<String, Boolean> productVisibility = fieldVisibilityService.getProductVisibility(tenantId);
        Map<String, String> productLabels = fieldVisibilityService.productFieldLabels();

        List<FieldEntry> productFields = new ArrayList<>();
        for (Map.Entry<String, Boolean> e : productVisibility.entrySet()) {
            productFields.add(new FieldEntry(
                e.getKey(),
                productLabels.getOrDefault(e.getKey(), e.getKey()),
                e.getValue()
            ));
        }

        Map<String, Boolean> transactionVisibility = fieldVisibilityService.getTransactionVisibility(tenantId);
        Map<String, String> transactionLabels = fieldVisibilityService.transactionFieldLabels();

        List<FieldEntry> transactionFields = new ArrayList<>();
        for (Map.Entry<String, Boolean> e : transactionVisibility.entrySet()) {
            transactionFields.add(new FieldEntry(
                e.getKey(),
                transactionLabels.getOrDefault(e.getKey(), e.getKey()),
                e.getValue()
            ));
        }

        Map<String, EntitySection> entities = new LinkedHashMap<>();
        entities.put(ENTITY_PRODUCT, new EntitySection("产品", productFields));
        entities.put(ENTITY_TRANSACTION, new EntitySection("出入库记录", transactionFields));
        return new FieldVisibilityResp(entities);
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    private UUID getUserId() {
        UUID userId = TenantContext.getUserId();
        if (userId == null) {
            throw BizException.of(401, "未登录");
        }
        return userId;
    }

    public record FieldVisibilityResp(Map<String, EntitySection> entities) {
    }

    public record EntitySection(String label, List<FieldEntry> fields) {
    }

    public record FieldEntry(String name, String label, boolean visible) {
    }

    public record SetFieldVisibilityReq(
        @NotBlank String entity,
        @NotBlank String field,
        Boolean visible
    ) {
    }
}

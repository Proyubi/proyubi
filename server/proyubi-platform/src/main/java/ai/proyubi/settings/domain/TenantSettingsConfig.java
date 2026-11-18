package ai.proyubi.settings.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.HashMap;
import java.util.Map;

/**
 * 租户业务配置 POJO（非 Entity）
 * 定义所有配置项及默认值，用于将 settings JSON 反序列化并与默认值合并。
 * DB 中未设置的字段自动使用此处默认值。
 *
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class TenantSettingsConfig {

    // --- 库存 ---

    /** 全局低库存阈值（产品未设置时使用） */
    private Integer defaultLowStockThreshold = 10;

    /** 是否允许负库存（超卖）。默认 false：出库数不能大于库存数 */
    private Boolean allowNegativeStock = false;

    // --- 扫码行为 ---

    /** 扫码后自动提交 */
    private Boolean scanAutoSubmit = false;

    /** 是否允许连扫 */
    private Boolean scanContinuousMode = false;

    /** 扫码防抖毫秒 */
    private Integer scanThrottleMs = 300;

    // --- 业务开关 ---

    /** 是否启用等级 */
    private Boolean gradeEnabled = false;

    /** 往来单位是否必填 */
    private Boolean contactRequired = false;

    // --- App 定制 ---

    /** App 图标 URL */
    private String appIconUrl;

    // --- 字段可见性 ---

    /**
     * 字段可见性覆盖：entity → field → visible
     * key 与前端字段名（小驼峰）一致，未设置的字段使用代码层定义的默认值。
     */
    private Map<String, Map<String, Boolean>> fieldOverrides = new HashMap<>();
}

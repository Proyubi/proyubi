package ai.proyubi.settings.domain;

/**
 * 产品实体可控字段（用于字段可见性配置）
 *
 * 仅枚举"可由租户控制是否显示"的字段。
 * 产品名、标签、产品图片、低库存阈值、备注等核心字段强制必显，不在此列。
 *
 * defaultVisible 为新租户开箱即用的默认值：
 * - SKU 默认开
 * - 客户、单位、条码、单价等扩展字段默认关，按需开启
 *
 * 出入库单价仍在出入库记录上；此处的产品级单价为「参考定价」，
 * 供产品/规格维度维护，默认关闭。
 *
 */
public enum ProductField {

    SKU("SKU", true),
    BARCODE("条码", false),
    SPEC_SIZE("规格尺寸", false),
    UNIT("单位", false),
    CONTACT("往来单位", false),
    UNIT_PRICE("单价", false);

    private final String label;
    private final boolean defaultVisible;

    ProductField(String label, boolean defaultVisible) {
        this.label = label;
        this.defaultVisible = defaultVisible;
    }

    public String getLabel() {
        return label;
    }

    public boolean isDefaultVisible() {
        return defaultVisible;
    }
}

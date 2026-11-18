package ai.proyubi.settings.domain;

/**
 * 出入库记录可控字段（用于字段可见性配置）
 *
 */
public enum TransactionField {

    UNIT_PRICE("出入库单价", true);

    private final String label;
    private final boolean defaultVisible;

    TransactionField(String label, boolean defaultVisible) {
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

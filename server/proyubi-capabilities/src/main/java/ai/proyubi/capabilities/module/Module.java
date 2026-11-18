package ai.proyubi.capabilities.module;

/**
 * 模块（产品）枚举 —— 平台的一等「产品」概念（拆分前遗留，Proyubi 只用 PM）。
 *
 * <p>对应 DB 表 {@code platform_module}。原平台托管多个独立模块，参照 freee 的形态：
 * 账号(认証認可)与租户(事業所)共享，但订阅/计费、准入/权限、分组(team)都按**模块**
 * 各自独立、不跨模块继承。</p>
 *
 * <p>{@link #sellable} 标识是否独立售卖（各自一份订阅）：当前 WMS / PM / BK 独立售卖；
 * REPORT / AI 为附加能力，不单独售卖。</p>
 *
 */
public enum Module {

    /** 在庫管理（核心 WMS）。独立售卖。 */
    WMS("wms", "在庫管理", true, null),

    /** 案件管理（PM / Gantt・WBS）。独立售卖。 */
    PM("pm", "案件管理", true, null),

    /** 記帳（管家记账）。独立售卖。 */
    BK("bk", "記帳", true, null),

    /** レポート（经营报表）。附加能力，不单独售卖。 */
    REPORT("report", "レポート", false, null),

    /** AI（LINE Bot・补充提案等）。跨模块附加能力，不单独售卖。 */
    AI("ai", "AI", false, null);

    private final String code;
    private final String displayName;
    private final boolean sellable;
    private final Module parent;

    Module(String code, String displayName, boolean sellable, Module parent) {
        this.code = code;
        this.displayName = displayName;
        this.sellable = sellable;
        this.parent = parent;
    }

    public String code() {
        return code;
    }

    public String displayName() {
        return displayName;
    }

    /** 是否独立售卖（拥有各自一份订阅）。 */
    public boolean isSellable() {
        return sellable;
    }

    /** 并入的父产品（子能力归属的母产品）；独立产品为 null。 */
    public Module parent() {
        return parent;
    }

    /** 按 code 解析，找不到返回 null。 */
    public static Module fromCode(String code) {
        if (code == null) {
            return null;
        }
        for (Module m : values()) {
            if (m.code.equals(code)) {
                return m;
            }
        }
        return null;
    }
}

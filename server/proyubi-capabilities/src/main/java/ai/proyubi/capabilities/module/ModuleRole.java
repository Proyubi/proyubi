package ai.proyubi.capabilities.module;

/**
 * 模块内角色 —— 用户在**某个模块**里的角色（freee 模型 A：角色按模块独立，不跨模块继承）。
 *
 * <p>对应 {@code platform_module_grant.role}。角色决定该模块内的默认权限；细粒度覆盖走
 * {@code platform_module_grant.permissions}(jsonb)。</p>
 *
 */
public enum ModuleRole {

    /** 模块所有者（通常 = 租户 owner）。 */
    OWNER("owner"),

    /** 模块管理员。 */
    ADMIN("admin"),

    /** 普通成员。 */
    MEMBER("member");

    private final String code;

    ModuleRole(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    /** 按 code 解析，找不到返回 {@link #MEMBER}。 */
    public static ModuleRole fromCode(String code) {
        if (code != null) {
            for (ModuleRole r : values()) {
                if (r.code.equals(code)) {
                    return r;
                }
            }
        }
        return MEMBER;
    }
}

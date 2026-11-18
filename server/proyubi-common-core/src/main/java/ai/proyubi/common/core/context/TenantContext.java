package ai.proyubi.common.core.context;

import java.util.UUID;

/**
 * 租户上下文工具类（V1简化实现）
 *
 */
public class TenantContext {

    private static final ThreadLocal<UUID> TENANT_ID = new ThreadLocal<>();
    private static final ThreadLocal<UUID> USER_ID = new ThreadLocal<>();
    private static final ThreadLocal<String> APP_CODE = new ThreadLocal<>();

    /**
     * 获取当前租户ID
     * V1阶段：通过拦截器或AOP设置，这里只从ThreadLocal获取
     */
    public static UUID getTenantId() {
        return TENANT_ID.get();
    }

    /**
     * 设置当前租户ID（用于拦截器或AOP）
     */
    public static void setTenantId(UUID tenantId) {
        TENANT_ID.set(tenantId);
    }

    /**
     * 获取当前用户ID
     * V1阶段：通过拦截器或AOP设置，这里只从ThreadLocal获取
     */
    public static UUID getUserId() {
        return USER_ID.get();
    }

    /**
     * 设置当前用户ID（用于拦截器或AOP）
     */
    public static void setUserId(UUID userId) {
        USER_ID.set(userId);
    }

    /**
     * 获取当前 App Code（如 user-web-cn）
     */
    public static String getAppCode() {
        return APP_CODE.get();
    }

    /**
     * 设置当前 App Code（由拦截器从 X-App-Code header 读取）
     */
    public static void setAppCode(String appCode) {
        APP_CODE.set(appCode);
    }

    /**
     * 清除上下文
     */
    public static void clear() {
        TENANT_ID.remove();
        USER_ID.remove();
        APP_CODE.remove();
    }
}

package ai.proyubi.server.config;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.satoken.stp.StpTenant;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.UUID;

/**
 * 租户上下文拦截器：从 SaToken Session 中读取 tenant_id / user_id，
 * 写入 TenantContext（ThreadLocal），供 Service / MyBatis-Flex 使用。
 *
 * 执行顺序：在 SaInterceptor 之后执行（order=2），确保 Token 已验证。
 */
@Component
public class TenantContextInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(TenantContextInterceptor.class);

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        try {
            // 读取 X-App-Code header（不依赖登录状态）
            String appCode = request.getHeader("X-App-Code");
            if (appCode != null && !appCode.isBlank()) {
                TenantContext.setAppCode(appCode.trim());
            }

            if (StpTenant.STP_LOGIC.isLogin()) {
                String tenantIdStr = (String) StpTenant.STP_LOGIC.getSession().get("tenant_id");
                if (tenantIdStr != null) {
                    TenantContext.setTenantId(UUID.fromString(tenantIdStr));
                    // 排查「登录后担当显示成 UUID」：对照同一时刻各请求解析到的 tenant_id。复现后改回 debug。
                    log.info("租户上下文已设置: uri={}, tenantId={}", request.getRequestURI(), tenantIdStr);
                } else {
                    log.warn("用户已登录但 Session 中缺少 tenant_id, loginId={}", StpTenant.STP_LOGIC.getLoginId());
                }
                String userIdStr = (String) StpTenant.STP_LOGIC.getSession().get("user_id");
                if (userIdStr != null) {
                    TenantContext.setUserId(UUID.fromString(userIdStr));
                }
            } else {
                log.debug("用户未登录，跳过租户上下文设置: {}", request.getRequestURI());
            }
        } catch (Exception e) {
            log.warn("设置租户上下文失败: {}", e.getMessage(), e);
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        TenantContext.clear();
    }
}

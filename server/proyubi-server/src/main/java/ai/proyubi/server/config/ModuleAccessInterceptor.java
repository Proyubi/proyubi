package ai.proyubi.server.config;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.platform.mapper.ModuleAccessMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.UUID;

/**
 * 模块准入网关（freee 模型 A）。order=3，在 SaInterceptor(1) / TenantContextInterceptor(2) 之后，
 * 此时 {@link TenantContext} 已填好 tenant_id / user_id。
 *
 * <p><b>为何用 HandlerInterceptor 而非注解</b>：模块准入是横切关注点，按 URL 前缀天然可拦、
 * 对 {@code /app/**} 统一兜底，无需逐 controller 贴注解（覆盖更全、改动更小、不会漏贴）。
 *
 * <p><b>灰度</b>：{@code proyubi.module-access.enabled} 默认 false。先让注册补发 grant
 * （ModuleGrantProvisioner）生效、确认存量 grant 覆盖后，再把开关翻 true 上线网关。
 * 一键 false 即回到「无网关」的今天行为。
 *
 * <p><b>401/403 语义</b>：未登录交给 SaInterceptor(order=1) 抛 401（前端踢登录）；
 * 已登录但无 grant 且非 owner → 本网关抛 {@code BizException.of(403)} →
 * 全局异常包成 {@code R{code:403}}（前端 message.error，不清 token、不踢登录）。
 */
@Component
public class ModuleAccessInterceptor implements HandlerInterceptor {

    /** 准入网关（人能否用该模块：module_grant）。默认关。 */
    @Value("${proyubi.module-access.enabled:false}")
    private boolean grantEnabled;

    /** 订阅网关（租户是否开通该模块：platform_subscription）。默认关，与准入网关相互独立。 */
    @Value("${proyubi.subscription-access.enabled:false}")
    private boolean subscriptionEnabled;

    private final ModuleAccessMapper mapper;

    public ModuleAccessInterceptor(ModuleAccessMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse resp, Object handler) {
        if (!grantEnabled && !subscriptionEnabled) {
            return true;                                       // 两道门都未开：放行（今天行为）
        }
        String module = ModuleRouteResolver.resolve(req.getRequestURI());
        if (module == null) {
            return true;                                       // 共享/未登记前缀：放行
        }
        UUID tenantId = TenantContext.getTenantId();
        UUID userId = TenantContext.getUserId();
        if (tenantId == null || userId == null) {
            return true;                                       // 未登录：交给 SaInterceptor 抛 401
        }

        // 准入网关：已登录、非 owner、且该模块无 grant → 403（前端提示「未开通该模块」）
        if (grantEnabled
                && mapper.countActiveGrant(tenantId, userId, module) == 0
                && !"owner".equals(mapper.findTenantRole(tenantId, userId))) {
            throw BizException.of(403, "未開通該模塊，請聯絡管理員");
        }

        // 订阅网关：租户该模块无活跃订阅 → 403。「开通」口径＝存在活跃订阅行（FREE 行亦算已开通）。
        if (subscriptionEnabled && mapper.countActiveSubscription(tenantId, module) == 0) {
            throw BizException.of(403, "該模塊尚未訂閱，請聯絡管理員");
        }

        return true;
    }
}

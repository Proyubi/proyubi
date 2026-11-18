package ai.proyubi.server.config;

import cn.dev33.satoken.interceptor.SaInterceptor;
import ai.proyubi.common.satoken.stp.StpPlatform;
import ai.proyubi.common.satoken.stp.StpTenant;
import ai.proyubi.common.web.interceptor.ApiLoggingInterceptor;
import ai.proyubi.common.web.interceptor.LocaleInterceptor;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Sa-Token 路由级拦截（运营/客户双体系）。
 *
 * <h2>公开路径（不加 Sa-Token 拦截）</h2>
 * <ul>
 *   <li>{@code /webhook/**} — 第三方平台回调（LINE Messaging API 等）。外部调用者不持有 satoken，
 *       由业务层自行做签名校验（见 {@link ai.proyubi.ai.service.LineSignatureValidator}）。
 *       若未来新增 {@code /webhook/**} 的 auth interceptor，务必先确认签名方案。</li>
 *   <li>{@code /actuator/**} / {@code /error} / {@code /favicon.ico}</li>
 * </ul>
 */
@Configuration
@RequiredArgsConstructor
public class SaTokenWebMvcConfig implements WebMvcConfigurer {

    private final ApiLoggingInterceptor apiLoggingInterceptor;
    private final LocaleInterceptor localeInterceptor;
    private final TenantContextInterceptor tenantContextInterceptor;
    private final InternalApiKeyInterceptor internalApiKeyInterceptor;
    private final ModuleAccessInterceptor moduleAccessInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // Locale 拦截器：设置 Locale 到 LocaleContextHolder（最先执行）
        registry.addInterceptor(localeInterceptor)
            .addPathPatterns("/**")
            .excludePathPatterns(
                "/actuator/**",
                "/error",
                "/favicon.ico"
            )
            .order(-1); // 最高优先级，确保最先执行
        
        // API 日志拦截器：记录所有 API 请求
        registry.addInterceptor(apiLoggingInterceptor)
            .addPathPatterns("/**")
            .excludePathPatterns(
                "/actuator/**",
                "/error",
                "/favicon.ico"
            )
            .order(0);

        // 运营后台：/ops/**
        registry.addInterceptor(new SaInterceptor(handle -> StpPlatform.checkLogin()))
            .addPathPatterns("/ops/**")
            .excludePathPatterns(
                "/ops/auth/login",
                "/ops/ping",
                "/actuator/**"
            )
            .order(1);

        // 客户侧：/app/**
        registry.addInterceptor(new SaInterceptor(handle -> StpTenant.checkLogin()))
            .addPathPatterns("/app/**")
            .excludePathPatterns(
                "/app/auth/login",
                "/app/auth/register",
                "/app/auth/oauth/**",
                "/app/auth/email/**",
                "/app/ping",
                "/app/public/**",
                "/actuator/**"
            )
            .order(1);

        // 机械用内部接口：/internal/**（不走 Sa-Token，由 API-Key + X-Tenant-Id 自前ガード）
        registry.addInterceptor(internalApiKeyInterceptor)
            .addPathPatterns("/internal/**")
            .order(2);

        // 租户上下文拦截器：在 SaToken 认证之后执行，从 Session 读取 tenant_id
        registry.addInterceptor(tenantContextInterceptor)
            .addPathPatterns("/app/**")
            .excludePathPatterns(
                "/app/auth/login",
                "/app/auth/register",
                "/app/auth/oauth/**",
                "/app/auth/email/**",
                "/app/ping",
                "/app/public/**",
                "/actuator/**"
            )
            .order(2);

        // 模块准入网关（freee 模型 A）：在 TenantContext 就绪后，按 URL 前缀校验该模块 grant。
        // owner 绕过；未登记前缀放行；灰度开关 proyubi.module-access.enabled 默认 false。
        // /app/auth|ping|public|bootstrap 等账号级/共享端点显式 exclude；其余共享前缀
        // （/app/team、/app/settings、/app/me 等）由 ModuleRouteResolver.resolve() 返回 null 放行。
        registry.addInterceptor(moduleAccessInterceptor)
            .addPathPatterns("/app/**")
            .excludePathPatterns(
                "/app/auth/**",
                "/app/ping",
                "/app/public/**",
                "/app/bootstrap/**",
                "/actuator/**"
            )
            .order(3);
    }
}



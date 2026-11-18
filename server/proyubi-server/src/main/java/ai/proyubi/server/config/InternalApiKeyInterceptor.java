package ai.proyubi.server.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.web.R;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * 机械用内部接口拦截器：保护 /internal/** 路径（不在 Sa-Token 拦截范围内，默认裸露）。
 *
 * <ul>
 *   <li>校验请求头 {@code X-Api-Key} 是否等于配置 {@code proyubi.internal-api.key}，不匹配返回 401。</li>
 *   <li>校验通过后读取 {@code X-Tenant-Id}，手动写入 {@link TenantContext}；缺失/非法返回 400。</li>
 *   <li>同时读取可选的 {@code X-User-Id}（MCP 令牌背后的真人），写入 {@link TenantContext}。</li>
 *   <li>{@code afterCompletion} 清理 ThreadLocal。</li>
 * </ul>
 * 配置为空时一律拒绝，避免误开放。
 *
 * <p><b>X-User-Id 的两个后果</b>（有意为之，不是副作用）：
 * <ol>
 *   <li>操作履历（{@code pm_task_activity}）署名为本人而非「MCP」。操作元徽标另由请求路径判定，
 *       所以画面上依然能区分「MCP 経由」。</li>
 *   <li>团队可见域（{@code PmTeamScopeService}）按该用户生效——即经 MCP 也只能看到自己团队的数据，
 *       与画面同一基准。以前只有 API-Key 时是租户全量，故这是<b>收紧</b>而非放宽：
 *       该头只能让调用者看得更少，不可能越权看得更多。</li>
 * </ol>
 * 头里的用户若不属于本租户，{@code findRole}/{@code listTeamIds} 均查不到 → 可见域为空 → 请求 404，
 * 即 fail-closed。
 */
@Component
public class InternalApiKeyInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(InternalApiKeyInterceptor.class);

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final String apiKey;

    public InternalApiKeyInterceptor(@Value("${proyubi.internal-api.key:}") String apiKey) {
        this.apiKey = apiKey;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        // 配置缺失则一律拒绝
        if (apiKey == null || apiKey.isBlank()) {
            log.warn("内部接口密钥未配置，拒绝访问: {}", request.getRequestURI());
            writeError(response, 401, "内部接口未启用");
            return false;
        }

        String provided = request.getHeader("X-Api-Key");
        if (provided == null || !apiKey.equals(provided)) {
            log.warn("内部接口密钥不匹配，拒绝访问: {}", request.getRequestURI());
            writeError(response, 401, "无效的 API Key");
            return false;
        }

        String tenantIdStr = request.getHeader("X-Tenant-Id");
        if (tenantIdStr == null || tenantIdStr.isBlank()) {
            writeError(response, 400, "缺少 X-Tenant-Id");
            return false;
        }
        try {
            TenantContext.setTenantId(UUID.fromString(tenantIdStr.trim()));
        } catch (IllegalArgumentException e) {
            writeError(response, 400, "非法的 X-Tenant-Id");
            return false;
        }

        // 操作者（任意）：pm-mcp / wms-mcp が MCP トークンから解決して毎リクエスト送っている真人の id。
        // 未送出（純粋な機械コンテキスト：定時同期など）はこれまでどおり user なしで通す。
        String userIdStr = request.getHeader("X-User-Id");
        if (userIdStr != null && !userIdStr.isBlank()) {
            try {
                TenantContext.setUserId(UUID.fromString(userIdStr.trim()));
            } catch (IllegalArgumentException e) {
                writeError(response, 400, "非法的 X-User-Id");
                return false;
            }
        }
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        TenantContext.clear();
    }

    private void writeError(HttpServletResponse response, int status, String msg) throws Exception {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write(MAPPER.writeValueAsString(R.fail(status, msg)));
    }
}

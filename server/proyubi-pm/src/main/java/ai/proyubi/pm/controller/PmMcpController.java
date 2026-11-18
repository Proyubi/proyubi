package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmMcpToken;
import ai.proyubi.pm.service.PmMcpTokenService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * PM MCP 个人连接（/app/pm/mcp）。
 *
 * 登录用户在「設定 → MCP設定」页拉取自己的连接 URL（内嵌个人令牌），
 * 粘到 ChatGPT / Claude 的 connector 即可用自然语言操作本 PM 系统。
 * 令牌与账号（platform_tenant_user）绑定，可随时重置失效。
 *
 */
@RestController
@RequestMapping("/app/pm/mcp")
public class PmMcpController {

    private final PmMcpTokenService tokenService;

    /** 公开的 MCP 服务基址（不含尾斜杠）。URL = {base}/t/{token}/mcp */
    @Value("${proyubi.pm.mcp.base-url:http://localhost:3110}")
    private String mcpBaseUrl;

    public PmMcpController(PmMcpTokenService tokenService) {
        this.tokenService = tokenService;
    }

    /** 取得（无则懒生成）当前用户的 MCP 连接。 */
    @GetMapping("/connection")
    public R<McpConnectionVO> connection() {
        PmMcpToken t = tokenService.findOrCreate(currentTenantId(), currentUserId());
        return R.ok(toVO(t));
    }

    /** 重置当前用户的令牌（旧 URL 立即失效，返回新 URL）。 */
    @PostMapping("/connection/regenerate")
    public R<McpConnectionVO> regenerate() {
        PmMcpToken t = tokenService.regenerate(currentTenantId(), currentUserId());
        return R.ok(toVO(t));
    }

    private McpConnectionVO toVO(PmMcpToken t) {
        String base = mcpBaseUrl == null ? "" : mcpBaseUrl.replaceAll("/+$", "");
        String url = base + "/t/" + t.getToken() + "/mcp";
        return new McpConnectionVO(url, t.getToken(), base, t.getCreatedAt());
    }

    private UUID currentTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    private UUID currentUserId() {
        UUID userId = TenantContext.getUserId();
        if (userId == null) {
            throw BizException.of(401, "用户信息缺失，请重新登录");
        }
        return userId;
    }

    /** MCP 连接信息（返回前端）。 */
    public record McpConnectionVO(
        String url,
        String token,
        String baseUrl,
        LocalDateTime createdAt
    ) {
    }
}

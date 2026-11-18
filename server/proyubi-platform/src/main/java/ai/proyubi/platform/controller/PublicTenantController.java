package ai.proyubi.platform.controller;

import ai.proyubi.common.core.web.R;
import ai.proyubi.platform.service.TenantService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 公开的租户品牌接口（未登录可访问）
 * <p>
 * 仅返回登录页展示所需的最小字段集，严禁暴露其他租户信息。
 * 路径以 /app/public/ 开头，需要在 SaTokenWebMvcConfig 中加入 excludePathPatterns。
 */
@RestController
@RequestMapping("/app/public/tenants")
@RequiredArgsConstructor
public class PublicTenantController {

    private final TenantService tenantService;

    /**
     * 按自定义域名查询登录页展示数据。
     * 未匹配时返回 null（前端使用默认 UI）。
     */
    @GetMapping("/by-domain")
    public R<PublicBrandingVO> getByDomain(@RequestParam("host") String host) {
        Map<String, Object> row = tenantService.getPublicBrandingByDomain(host);
        if (row == null) {
            return R.ok(null);
        }
        PublicBrandingVO vo = new PublicBrandingVO();
        vo.setName(asString(row.get("name")));
        vo.setLoginLogoUrl(asString(row.get("loginLogoUrl")));
        vo.setLoginTitle(asString(row.get("loginTitle")));
        vo.setLoginSubtitle(asString(row.get("loginSubtitle")));
        return R.ok(vo);
    }

    private static String asString(Object o) {
        return o == null ? null : o.toString();
    }

    @Data
    public static class PublicBrandingVO {
        private String name;
        private String loginLogoUrl;
        private String loginTitle;
        private String loginSubtitle;
    }
}

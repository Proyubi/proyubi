package ai.proyubi.platform.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.platform.domain.TenantDetailVO;
import ai.proyubi.platform.mapper.TenantMapper;
import ai.proyubi.account.service.StorageResolver;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 租户管理服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TenantService {

    /** 登录 logo 的宿主 app（与 user-web-cn 共用同一 OSS 配置，保证登录页可直接访问） */
    private static final String BRANDING_APP_CODE = "user-web-cn";
    private static final String BRANDING_SUBFOLDER = "tenant-branding";
    private static final long LOGO_MAX_SIZE = 500 * 1024; // 500KB
    private static final List<String> LOGO_ALLOWED_TYPES = List.of(
        "image/jpeg", "image/png", "image/webp", "image/svg+xml"
    );

    private final TenantMapper tenantMapper;
    private final StorageResolver storageResolver;

    /**
     * 更新租户登录页品牌与自定义域名
     */
    @Transactional
    public TenantDetailVO updateBranding(UUID id,
                                         String customDomain,
                                         String loginLogoUrl,
                                         String loginTitle,
                                         String loginSubtitle) {
        TenantDetailVO current = tenantMapper.selectTenantDetail(id);
        if (current == null) {
            throw BizException.of(404, "租户不存在");
        }

        String normalizedDomain = normalizeDomain(customDomain);
        if (normalizedDomain != null) {
            long conflict = tenantMapper.countByCustomDomainExcluding(normalizedDomain, id);
            if (conflict > 0) {
                throw BizException.of(400, "该域名已被其他租户占用");
            }
        }

        tenantMapper.updateBranding(
            id,
            normalizedDomain,
            blankToNull(loginLogoUrl),
            blankToNull(loginTitle),
            blankToNull(loginSubtitle)
        );
        return tenantMapper.selectTenantDetail(id);
    }

    /**
     * 按域名查询登录页展示数据（公开接口调用）
     */
    public Map<String, Object> getPublicBrandingByDomain(String host) {
        if (host == null || host.isBlank()) {
            return null;
        }
        String normalized = normalizeDomain(host);
        if (normalized == null) {
            return null;
        }
        return tenantMapper.selectPublicBrandingByDomain(normalized);
    }

    // ========== Helpers ==========

    private static String normalizeDomain(String raw) {
        if (raw == null) return null;
        String s = raw.trim().toLowerCase();
        if (s.isEmpty()) return null;
        // 去协议
        if (s.startsWith("http://")) s = s.substring(7);
        else if (s.startsWith("https://")) s = s.substring(8);
        // 去路径
        int slash = s.indexOf('/');
        if (slash >= 0) s = s.substring(0, slash);
        // 去端口
        int colon = s.indexOf(':');
        if (colon >= 0) s = s.substring(0, colon);
        return s.isEmpty() ? null : s;
    }

    private static String blankToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}

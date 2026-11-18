package ai.proyubi.pm.service;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmMcpToken;
import ai.proyubi.pm.mapper.PmMcpTokenMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * PM MCP 个人连接令牌 Service。
 *
 * 每个租户用户一条有效令牌（deleted_at is null）：
 * <ul>
 *   <li>{@link #findOrCreate} — 「設定 → MCP設定」页拉取时用；无则懒生成。</li>
 *   <li>{@link #regenerate} — 用户点「重置/失效」时用；软删旧令牌再建新。</li>
 *   <li>{@link #resolve} — pm-mcp 服务端凭 token 反查（返回 tenant）。</li>
 * </ul>
 *
 */
@Service
public class PmMcpTokenService {

    private static final Logger log = LoggerFactory.getLogger(PmMcpTokenService.class);

    private final PmMcpTokenMapper mapper;
    private final SecureRandom random = new SecureRandom();

    public PmMcpTokenService(PmMcpTokenMapper mapper) {
        this.mapper = mapper;
    }

    /** 取得该租户用户的有效令牌；不存在则新建。 */
    @Transactional
    public PmMcpToken findOrCreate(UUID tenantId, UUID userId) {
        if (tenantId == null || userId == null) {
            throw BizException.of(401, "租户/用户信息缺失，请重新登录");
        }
        PmMcpToken existing = findActive(tenantId, userId);
        if (existing != null) {
            return existing;
        }
        return insertNew(tenantId, userId);
    }

    /** 重置：软删该用户现有有效令牌，再建一条新的（旧 URL 立即失效）。 */
    @Transactional
    public PmMcpToken regenerate(UUID tenantId, UUID userId) {
        if (tenantId == null || userId == null) {
            throw BizException.of(401, "租户/用户信息缺失，请重新登录");
        }
        PmMcpToken existing = findActive(tenantId, userId);
        if (existing != null) {
            existing.setDeletedAt(LocalDateTime.now());
            existing.setUpdatedAt(LocalDateTime.now());
            mapper.update(existing);
        }
        return insertNew(tenantId, userId);
    }

    /**
     * pm-mcp 服务端反查：token → 有效令牌行（返回其 tenant）。找不到返回 null（视为 401）。
     * 全局按 token 查（不限 tenant）——token 本身即密钥，唯一索引保证至多一条。
     */
    public PmMcpToken resolve(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        // 本查询天然「跨租户」：token 即密钥，要按 token 全局反查它属于哪个 tenant。
        // 但 /internal 拦截器会把请求头的（占位）X-Tenant-Id 写入 TenantContext，
        // 于是 MyBatis-Flex 的租户拦截器会给这条 SELECT 追加 AND tenant_id=<占位> → 永远查不到。
        // 因此查询前临时清空租户上下文（ProyubiTenantFactory 见 null 即不追加条件），查完复原。
        UUID savedTenant = TenantContext.getTenantId();
        try {
            TenantContext.setTenantId(null);
            List<PmMcpToken> rows = mapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmMcpToken::getToken).eq(token.trim())
                    .and(PmMcpToken::getDeletedAt).isNull());
            return rows.isEmpty() ? null : rows.get(0);
        } finally {
            TenantContext.setTenantId(savedTenant);
        }
    }

    private PmMcpToken findActive(UUID tenantId, UUID userId) {
        List<PmMcpToken> rows = mapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmMcpToken::getTenantId).eq(tenantId)
                .and(PmMcpToken::getUserId).eq(userId)
                .and(PmMcpToken::getDeletedAt).isNull());
        return rows.isEmpty() ? null : rows.get(0);
    }

    private PmMcpToken insertNew(UUID tenantId, UUID userId) {
        PmMcpToken t = new PmMcpToken();
        t.setId(UUID.randomUUID());
        t.setTenantId(tenantId);
        t.setUserId(userId);
        t.setToken(generateToken());
        LocalDateTime now = LocalDateTime.now();
        t.setCreatedAt(now);
        t.setUpdatedAt(now);
        mapper.insert(t);
        log.info("[pm-mcp] issued MCP token for tenant={} user={}", tenantId, userId);
        return t;
    }

    /** 24 字节 SecureRandom → 48 位 hex（与 AppInvitationService 邀请码同风格）。 */
    private String generateToken() {
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}

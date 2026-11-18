package ai.proyubi.account.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.identity.mail.MailLocale;
import ai.proyubi.identity.mail.MailService;
import ai.proyubi.account.domain.InvitationVO;
import ai.proyubi.account.mapper.AppInvitationMapper;
import ai.proyubi.account.mapper.AppTeamMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.io.IOException;
import java.net.URI;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.regex.Pattern;

/**
 * 团队邀请服务（owner 侧）。
 *
 * <p>负责邀请的创建、列表、撤销、重发、邮件发送。被邀请人侧的 inbox/accept/decline
 * 在 PR3 引入 {@code AppMyInvitationService}（仅当前文件不处理跨租户落地的事务）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AppInvitationService {

    /** 邀请有效期（天）。 */
    private static final int EXPIRES_DAYS = 7;

    private static final Pattern EMAIL_PATTERN =
            Pattern.compile("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$");

    private final AppInvitationMapper invitationMapper;
    private final AppTeamMapper teamMapper;
    private final AppTeamGroupService teamGroupService;
    private final ObjectMapper objectMapper;
    private final MailService mailService;
    private final SecureRandom random = new SecureRandom();

    @Value("${app.web-base-url:http://localhost:8000}")
    private String webBaseUrl;

    /**
     * 创建邀请。失败抛 BizException；成功返回新邀请的 VO。
     */
    @Transactional
    public InvitationVO createInvitation(UUID tenantId, UUID inviterUserId,
                                          String email, String displayName,
                                          List<String> customPermissions, String message,
                                          List<UUID> teamIds) {
        String normalizedEmail = normalizeEmail(email);

        // 校验：邀请人不能邀请自己
        Map<String, Object> inviter = teamMapper.findMemberById(inviterUserId, tenantId);
        if (inviter == null) {
            throw BizException.of(404, "邀请人信息不存在");
        }

        // 校验：该 email 是否已是本租户成员
        if (invitationMapper.existsMemberByEmailInTenant(tenantId, normalizedEmail) != null) {
            throw BizException.of(400, "该邮箱已是团队成员");
        }

        // 校验：是否已有 pending 邀请（同租户同邮箱只允许一条 pending）
        Map<String, Object> existing = invitationMapper.findPendingByEmail(tenantId, normalizedEmail);
        if (existing != null) {
            throw BizException.of(400, "该邮箱已有未处理的邀请，请先撤销或重发");
        }

        UUID id = UUID.randomUUID();
        String token = generateToken();
        OffsetDateTime expiresAt = OffsetDateTime.now().plusDays(EXPIRES_DAYS);
        String customPermsJson = serializePermissions(customPermissions);
        String teamIdsJson = resolveTeamIdsJson(tenantId, teamIds);

        invitationMapper.insert(id, tenantId, inviterUserId, normalizedEmail, displayName,
                "member", customPermsJson, message, token, expiresAt, teamIdsJson);

        // 发送邀请邮件（失败不阻塞主流程，仅记录日志）
        sendInvitationEmail(normalizedEmail, inviterUserId, tenantId, token, message);

        return toVO(invitationMapper.findById(id), false, false);
    }

    /**
     * 列出某租户的邀请。
     *
     * @param status 可选过滤；null 表示所有非删除记录。
     */
    public List<InvitationVO> listByTenant(UUID tenantId, String status) {
        List<Map<String, Object>> rows = invitationMapper.listByTenant(tenantId, status);
        List<InvitationVO> result = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            result.add(toVO(row, null, null));
        }
        return result;
    }

    /**
     * 检查邮箱是否可邀请：是否在系统中已注册、是否已是本租户成员、是否已 pending。
     */
    public InvitationVO checkEmail(UUID tenantId, String email) {
        String normalized = normalizeEmail(email);
        boolean alreadyMember = invitationMapper.existsMemberByEmailInTenant(tenantId, normalized) != null;
        boolean accountExists = invitationMapper.existsAccountByEmail(normalized) != null;
        Map<String, Object> pending = invitationMapper.findPendingByEmail(tenantId, normalized);

        InvitationVO vo = new InvitationVO();
        vo.setEmail(normalized);
        vo.setAlreadyMember(alreadyMember);
        vo.setAccountExists(accountExists);
        if (pending != null) {
            vo.setId((UUID) pending.get("id"));
            vo.setStatus("pending");
            vo.setExpiresAt(toOffsetDateTime(pending.get("expiresAt")));
            vo.setCreatedAt(toOffsetDateTime(pending.get("createdAt")));
        }
        return vo;
    }

    /**
     * 撤销邀请（仅 pending 可撤销）。
     */
    @Transactional
    public void revoke(UUID tenantId, UUID invitationId) {
        Map<String, Object> inv = invitationMapper.findById(invitationId);
        if (inv == null || !tenantId.equals(inv.get("tenantId"))) {
            throw BizException.of(404, "邀请不存在");
        }
        if (!"pending".equals(inv.get("status"))) {
            throw BizException.of(400, "该邀请已结束，无法撤销");
        }
        invitationMapper.updateStatus(invitationId, "revoked", null);
    }

    /**
     * 重发邀请（仅 pending 可重发）：刷新 token 与过期时间，重发邮件。
     */
    @Transactional
    public InvitationVO resend(UUID tenantId, UUID invitationId) {
        Map<String, Object> inv = invitationMapper.findById(invitationId);
        if (inv == null || !tenantId.equals(inv.get("tenantId"))) {
            throw BizException.of(404, "邀请不存在");
        }
        if (!"pending".equals(inv.get("status"))) {
            throw BizException.of(400, "该邀请已结束，无法重发");
        }

        String token = generateToken();
        OffsetDateTime expiresAt = OffsetDateTime.now().plusDays(EXPIRES_DAYS);
        invitationMapper.refreshForResend(invitationId, expiresAt, token);

        sendInvitationEmail((String) inv.get("email"),
                (UUID) inv.get("inviterUserId"),
                (UUID) inv.get("tenantId"),
                token,
                (String) inv.get("message"));

        return toVO(invitationMapper.findById(invitationId), null, null);
    }

    // --- helpers ---

    private void sendInvitationEmail(String email, UUID inviterUserId, UUID tenantId,
                                     String token, String message) {
        MailLocale.Lang lang = MailLocale.current();

        Map<String, Object> info = invitationMapper.findInviterAndTenantInfo(inviterUserId);
        String inviterName = info != null ? safeString(info, "inviterName") : null;
        String tenantName = info != null ? safeString(info, "tenantName") : null;
        // 弱化品牌：优先用租户名，租户名为空时才回退通用产品名（不硬编码产品名）。
        if (tenantName == null || tenantName.isBlank()) {
            tenantName = MailLocale.genericAppName(lang);
        }

        // 链接域名跟随发起邀请时的请求环境（Origin/Referer），取不到时回退配置 app.web-base-url。
        String acceptUrl = resolveBaseUrl() + "/invitations/accept?token=" + token;
        String subject = buildInvitationSubject(lang, tenantName);
        String body = buildInvitationBody(lang, nullToEmpty(inviterName), tenantName, acceptUrl);

        if (message != null && !message.isBlank()) {
            body = body + "\n" + messageLabel(lang) + "\n" + message + "\n";
        }

        MailService.SendResult result = mailService.sendText(email, subject, body);
        if (result == MailService.SendResult.FAILED) {
            // 邮件失败不抛业务异常，邀请已落库；用户可点"重发"
            log.warn("Send invitation email failed: to={} tenantId={}", email, tenantId);
        }
    }

    private static String buildInvitationSubject(MailLocale.Lang lang, String tenantName) {
        return switch (lang) {
            case JA -> "「" + tenantName + "」への招待";
            case EN -> "Invitation to join " + tenantName;
            case ZH -> "邀请加入「" + tenantName + "」";
        };
    }

    private static String buildInvitationBody(MailLocale.Lang lang, String inviterName,
                                              String tenantName, String acceptUrl) {
        return switch (lang) {
            case JA -> """
                %s さんがあなたを「%s」への参加に招待しました。

                以下のリンクからログインして招待を確認してください：

                    %s

                このリンクは 7 日間有効です。心当たりがない場合は本メールを破棄してください。
                """.formatted(inviterName, tenantName, acceptUrl);
            case EN -> """
                %s invited you to join "%s".

                Sign in via the following link to review the invitation:

                    %s

                This link expires in 7 days. If you didn't expect this email, please ignore it.
                """.formatted(inviterName, tenantName, acceptUrl);
            case ZH -> """
                %s 邀请您加入「%s」。

                请通过以下链接登录并查看邀请：

                    %s

                该链接 7 天内有效。如非本人操作，请忽略此邮件。
                """.formatted(inviterName, tenantName, acceptUrl);
        };
    }

    private static String messageLabel(MailLocale.Lang lang) {
        return switch (lang) {
            case JA -> "----- メッセージ -----";
            case EN -> "----- Message -----";
            case ZH -> "----- 留言 -----";
        };
    }

    /**
     * 邀请链接的 base URL，按可靠性递降取值，让邮件里的地址与邀请人当前所在站点一致
     * （如 https://pm.example.com）：
     * <ol>
     *   <li>{@code X-App-Base-Url} —— 前端显式声明的 {@code window.location.origin}（最可靠，
     *       不受 dev 代理 {@code changeOrigin} 改写 Host/Origin 的影响）；</li>
     *   <li>{@code Origin} / {@code Referer} 请求头（同源反向代理直连场景）；</li>
     *   <li>配置 {@code app.web-base-url} 兜底。</li>
     * </ol>
     * 注意链接指向的是<strong>前端</strong>站点（SPA 路由 {@code /invitations/accept}），不是后端 API。
     */
    private String resolveBaseUrl() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
            HttpServletRequest req = attrs.getRequest();
            String declared = req.getHeader("X-App-Base-Url");
            if (declared != null && !declared.isBlank()) {
                return stripTrailingSlash(declared.trim());
            }
            String fromRequest = baseFromOriginOrReferer(req);
            if (fromRequest != null) {
                return fromRequest;
            }
        }
        return stripTrailingSlash(webBaseUrl);
    }

    private static String baseFromOriginOrReferer(HttpServletRequest req) {
        String origin = req.getHeader("Origin");
        if (origin != null && !origin.isBlank() && !"null".equalsIgnoreCase(origin.trim())) {
            return stripTrailingSlash(origin.trim());
        }
        String referer = req.getHeader("Referer");
        if (referer != null && !referer.isBlank()) {
            try {
                URI uri = URI.create(referer.trim());
                if (uri.getScheme() != null && uri.getHost() != null) {
                    StringBuilder sb = new StringBuilder()
                            .append(uri.getScheme()).append("://").append(uri.getHost());
                    if (uri.getPort() != -1) {
                        sb.append(':').append(uri.getPort());
                    }
                    return sb.toString();
                }
            } catch (IllegalArgumentException ignore) {
                // Referer 非法 URL → 回退配置
            }
        }
        return null;
    }

    private static String stripTrailingSlash(String url) {
        if (url == null) return null;
        String trimmed = url.trim();
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }

    private InvitationVO toVO(Map<String, Object> row, Boolean accountExists, Boolean alreadyMember) {
        if (row == null) return null;
        InvitationVO vo = new InvitationVO();
        vo.setId((UUID) row.get("id"));
        vo.setTenantId((UUID) row.get("tenantId"));
        vo.setInviterUserId((UUID) row.get("inviterUserId"));
        vo.setInviterName((String) row.get("inviterName"));
        vo.setTenantName((String) row.get("tenantName"));
        vo.setEmail((String) row.get("email"));
        vo.setDisplayName((String) row.get("displayName"));
        vo.setRole((String) row.get("role"));
        vo.setMessage((String) row.get("message"));
        vo.setStatus((String) row.get("status"));
        vo.setExpiresAt(toOffsetDateTime(row.get("expiresAt")));
        vo.setAcceptedAt(toOffsetDateTime(row.get("acceptedAt")));
        vo.setCreatedAt(toOffsetDateTime(row.get("createdAt")));
        vo.setAccountExists(accountExists);
        vo.setAlreadyMember(alreadyMember);

        String permsJson = (String) row.get("customPermissions");
        if (permsJson != null && !permsJson.isBlank()) {
            try {
                vo.setCustomPermissions(objectMapper.readValue(permsJson, new TypeReference<List<String>>() {}));
            } catch (IOException e) {
                log.warn("Parse invitation custom_permissions failed: {}", e.getMessage());
            }
        }

        String teamIdsJson = (String) row.get("teamIds");
        if (teamIdsJson != null && !teamIdsJson.isBlank()) {
            try {
                vo.setTeamIds(objectMapper.readValue(teamIdsJson, new TypeReference<List<String>>() {}));
            } catch (IOException e) {
                log.warn("Parse invitation team_ids failed: {}", e.getMessage());
            }
        }
        return vo;
    }

    /**
     * 解析邀请目标团队为 jsonb 字符串（UUID 字符串数组）。
     *
     * <p>FREE（不支持多团队）或未选团队 → 落默认团队；PRO/TRIAL 选了团队 → 校验归属本租户后存。
     * 返回 null 表示不指定（接受时回退默认团队）。
     */
    private String resolveTeamIdsJson(UUID tenantId, List<UUID> requested) {
        List<UUID> resolved;
        if (!teamGroupService.canMultiTeam(tenantId) || requested == null || requested.isEmpty()) {
            UUID def = teamMapper.findDefaultTeamId(tenantId);
            if (def == null) return null;
            resolved = List.of(def);
        } else {
            for (UUID tid : requested) {
                if (teamMapper.findTeamById(tid, tenantId) == null) {
                    throw BizException.of(400, "团队不存在");
                }
            }
            resolved = requested.stream().distinct().toList();
        }
        try {
            return objectMapper.writeValueAsString(resolved.stream().map(UUID::toString).toList());
        } catch (JsonProcessingException e) {
            throw BizException.of(500, "团队数据序列化失败");
        }
    }

    private String serializePermissions(List<String> permissions) {
        if (permissions == null || permissions.isEmpty()) return null;
        try {
            return objectMapper.writeValueAsString(permissions);
        } catch (JsonProcessingException e) {
            throw BizException.of(500, "权限数据序列化失败");
        }
    }

    private String generateToken() {
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static String normalizeEmail(String email) {
        if (email == null || email.isBlank()) {
            throw BizException.of(400, "请输入邮箱");
        }
        String normalized = email.trim().toLowerCase();
        if (!EMAIL_PATTERN.matcher(normalized).matches()) {
            throw BizException.of(400, "邮箱格式不正确");
        }
        return normalized;
    }

    private static String safeString(Map<String, Object> row, String key) {
        if (row == null) return null;
        Object v = row.get(key);
        return v == null ? null : v.toString();
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    /**
     * 把 JDBC 返回的时间值（Timestamp / Instant / OffsetDateTime）统一成 OffsetDateTime。
     *
     * <p>MyBatis 用 {@code Map<String, Object>} 接 timestamptz 时，PostgreSQL JDBC
     * 默认返回 {@link java.sql.Timestamp}，直接强转 OffsetDateTime 会抛 ClassCastException
     * 把整个事务回滚（邮件已发出 → DB 行被回滚 → 出现"收到邮件但表里没数据"）。
     */
    static OffsetDateTime toOffsetDateTime(Object v) {
        if (v == null) return null;
        if (v instanceof OffsetDateTime odt) return odt;
        if (v instanceof Timestamp ts) return ts.toInstant().atOffset(ZoneOffset.UTC);
        if (v instanceof Instant in) return in.atOffset(ZoneOffset.UTC);
        throw new IllegalStateException(
            "Unsupported timestamp type: " + v.getClass().getName());
    }
}

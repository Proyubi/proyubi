package ai.proyubi.account.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.account.domain.InvitationVO;
import ai.proyubi.account.mapper.AppInvitationMapper;
import ai.proyubi.account.mapper.AppTeamMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 邀请 — 被邀请人侧（inbox / accept / decline）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AppMyInvitationService {

    private final AppInvitationMapper invitationMapper;
    private final AppTeamMapper teamMapper;
    private final ObjectMapper objectMapper;

    /** 接受结果：包含落地后的 tenant_user_id，前端可据此提示"切换团队"。 */
    public record AcceptResult(UUID tenantUserId, UUID tenantId, String tenantName) {}

    /**
     * 邮件深链接受页的预览信息（公开，无需登录）。
     *
     * <p>仅暴露渲染所需字段，不回传 token / 内部 ID。{@code status} 为派生值：pending 但已过期时返回
     * {@code expired}（不写库，GET 保持只读）。
     */
    public record InvitationPreview(String tenantName, String inviterName, String email,
                                    String role, String status, String message,
                                    OffsetDateTime expiresAt) {}

    /**
     * 凭 token 预览邀请（公开）。token 无效 / 邀请已删除 → 404。
     */
    public InvitationPreview previewByToken(String token) {
        if (token == null || token.isBlank()) {
            throw BizException.of(400, "邀请链接无效");
        }
        Map<String, Object> inv = invitationMapper.findByToken(token);
        if (inv == null) {
            throw BizException.of(404, "邀请不存在或链接已失效");
        }
        String status = (String) inv.get("status");
        OffsetDateTime expiresAt = AppInvitationService.toOffsetDateTime(inv.get("expiresAt"));
        if ("pending".equals(status) && expiresAt != null && expiresAt.isBefore(OffsetDateTime.now())) {
            status = "expired";
        }
        return new InvitationPreview(
                (String) inv.get("tenantName"),
                (String) inv.get("inviterName"),
                (String) inv.get("email"),
                (String) inv.get("role"),
                status,
                (String) inv.get("message"),
                expiresAt);
    }

    /**
     * 凭 token 接受邀请（需登录）。解析 token 拿到邀请 ID 后复用 {@link #accept}，由其统一校验
     * 邮箱归属、pending、过期等。
     */
    @Transactional
    public AcceptResult acceptByToken(String accountEmail, String token) {
        if (token == null || token.isBlank()) {
            throw BizException.of(400, "邀请链接无效");
        }
        Map<String, Object> inv = invitationMapper.findByToken(token);
        if (inv == null) {
            throw BizException.of(404, "邀请不存在或链接已失效");
        }
        return accept(accountEmail, (UUID) inv.get("id"));
    }

    /**
     * 当前用户邮箱名下的所有 pending 邀请。
     */
    public List<InvitationVO> listInbox(String accountEmail) {
        if (accountEmail == null || accountEmail.isBlank()) {
            return List.of();
        }
        List<Map<String, Object>> rows = invitationMapper.listPendingByEmail(accountEmail);
        List<InvitationVO> result = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            result.add(toInboxVO(row));
        }
        return result;
    }

    /**
     * 接受邀请：在邀请方租户下创建 tenant_user + email identity，并把邀请置为 accepted。
     */
    @Transactional
    public AcceptResult accept(String accountEmail, UUID invitationId) {
        Map<String, Object> inv = requireValidInvitation(accountEmail, invitationId);

        UUID tenantId = (UUID) inv.get("tenantId");
        UUID inviterUserId = (UUID) inv.get("inviterUserId");
        String role = (String) inv.get("role");
        String displayName = (String) inv.get("displayName");
        String customPermsJson = (String) inv.get("customPermissions");
        String tenantName = (String) inv.get("tenantName");

        // 幂等：如果已经是该租户成员（在不同情况下被并发触发），直接复用现有 tenant_user
        UUID existingTenantUserId =
                invitationMapper.findTenantUserIdByEmailInTenant(tenantId, accountEmail);
        UUID tenantUserId;
        if (existingTenantUserId != null) {
            tenantUserId = existingTenantUserId;
        } else {
            tenantUserId = UUID.randomUUID();
            String fallbackName = (displayName != null && !displayName.isBlank())
                    ? displayName : accountEmail;
            invitationMapper.insertTenantUserFromInvitation(
                    tenantUserId, tenantId, fallbackName, role, inviterUserId);
            invitationMapper.insertEmailMembershipIdentity(
                    UUID.randomUUID(), tenantUserId, tenantId, accountEmail);
        }

        // 落地团队成员关系：按邀请的 team_ids（空→默认团队），幂等加入。
        assignTeams(tenantId, tenantUserId, (String) inv.get("teamIds"));

        // ③-b（模型 A）：按模块发 grant。wms 取邀请的角色 + 权限快照（customPermsJson，null=默认）；
        // pm/bk 发默认成员 grant，保持"成员可达各可售模块"现状（与 platform_module_grant 回填一致）。
        // upsert 幂等：grant 已存在则只更新 permissions、保留既有 role。
        String grantRole = "owner".equals(role) ? "owner" : "member";
        teamMapper.upsertGrantPermissions(tenantId, tenantUserId, "wms", grantRole, customPermsJson);
        teamMapper.upsertGrantPermissions(tenantId, tenantUserId, "pm", grantRole, null);
        teamMapper.upsertGrantPermissions(tenantId, tenantUserId, "bk", grantRole, null);

        invitationMapper.updateStatus(invitationId, "accepted", tenantUserId);

        return new AcceptResult(tenantUserId, tenantId, tenantName);
    }

    /**
     * 把被邀请人加入邀请指定的团队（team_ids 为空时回退默认团队）。幂等：已在团队内则跳过。
     * 团队若已被删除（findTeamById 返回 null）则忽略该项。
     */
    private void assignTeams(UUID tenantId, UUID tenantUserId, String teamIdsJson) {
        List<UUID> teamIds = parseTeamIds(teamIdsJson);
        if (teamIds.isEmpty()) {
            UUID def = teamMapper.findDefaultTeamId(tenantId);
            if (def != null) teamIds = List.of(def);
        }
        for (UUID teamId : teamIds) {
            if (teamMapper.findTeamById(teamId, tenantId) == null) continue;       // 团队已删/不属本租户
            if (teamMapper.listTeamMemberIds(teamId).contains(tenantUserId)) continue; // 已是成员
            teamMapper.insertTeamMember(UUID.randomUUID(), tenantId, teamId, tenantUserId);
        }
    }

    private List<UUID> parseTeamIds(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            List<String> raw = objectMapper.readValue(json, new TypeReference<List<String>>() {});
            List<UUID> ids = new ArrayList<>(raw.size());
            for (String s : raw) {
                try { ids.add(UUID.fromString(s)); } catch (IllegalArgumentException ignore) { /* skip */ }
            }
            return ids;
        } catch (IOException e) {
            log.warn("Parse invitation team_ids failed: {}", e.getMessage());
            return List.of();
        }
    }

    /**
     * 拒绝邀请。
     */
    @Transactional
    public void decline(String accountEmail, UUID invitationId) {
        requireValidInvitation(accountEmail, invitationId);
        invitationMapper.updateStatus(invitationId, "declined", null);
    }

    // --- helpers ---

    private Map<String, Object> requireValidInvitation(String accountEmail, UUID invitationId) {
        if (accountEmail == null || accountEmail.isBlank()) {
            throw BizException.of(403, "当前登录方式不支持处理邀请");
        }
        Map<String, Object> inv = invitationMapper.findById(invitationId);
        if (inv == null) {
            throw BizException.of(404, "邀请不存在");
        }
        String invEmail = (String) inv.get("email");
        if (invEmail == null || !invEmail.equalsIgnoreCase(accountEmail)) {
            throw BizException.of(403, "该邀请不属于当前账号");
        }
        if (!"pending".equals(inv.get("status"))) {
            throw BizException.of(400, "该邀请已处理");
        }
        OffsetDateTime expiresAt = AppInvitationService.toOffsetDateTime(inv.get("expiresAt"));
        if (expiresAt != null && expiresAt.isBefore(OffsetDateTime.now())) {
            // 顺便把状态更新为 expired
            invitationMapper.updateStatus(invitationId, "expired", null);
            throw BizException.of(400, "该邀请已过期");
        }
        return inv;
    }

    private InvitationVO toInboxVO(Map<String, Object> row) {
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
        vo.setExpiresAt(AppInvitationService.toOffsetDateTime(row.get("expiresAt")));
        vo.setCreatedAt(AppInvitationService.toOffsetDateTime(row.get("createdAt")));

        String permsJson = (String) row.get("customPermissions");
        if (permsJson != null && !permsJson.isBlank()) {
            try {
                vo.setCustomPermissions(objectMapper.readValue(permsJson, new TypeReference<List<String>>() {}));
            } catch (IOException e) {
                log.warn("Parse invitation custom_permissions failed: {}", e.getMessage());
            }
        }
        return vo;
    }
}

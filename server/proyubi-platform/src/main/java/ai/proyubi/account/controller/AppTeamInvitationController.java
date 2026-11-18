package ai.proyubi.account.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.account.domain.InvitationVO;
import ai.proyubi.account.mapper.AppTeamMapper;
import ai.proyubi.account.service.AppInvitationService;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 团队邀请管理（owner 侧）
 */
@RestController
@RequestMapping("/app/team/invitations")
@Validated
@RequiredArgsConstructor
public class AppTeamInvitationController {

    private final AppInvitationService invitationService;
    private final AppTeamMapper teamMapper;

    /**
     * 列出本租户的邀请；可按 status 过滤（pending/accepted/declined/revoked/expired）。
     */
    @GetMapping
    public R<List<InvitationVO>> list(@RequestParam(required = false) String status) {
        UUID tenantId = getTenantId();
        checkOwnerRole(getUserId());
        return R.ok(invitationService.listByTenant(tenantId, status));
    }

    /**
     * 检查邮箱是否可邀请（实时回显）。
     */
    @GetMapping("/check")
    public R<InvitationVO> check(@RequestParam @NotBlank @Email String email) {
        UUID tenantId = getTenantId();
        checkOwnerRole(getUserId());
        return R.ok(invitationService.checkEmail(tenantId, email));
    }

    /**
     * 创建邀请。
     */
    @PostMapping
    public R<InvitationVO> create(@RequestBody @Validated CreateInvitationReq req) {
        UUID tenantId = getTenantId();
        UUID inviterUserId = getUserId();
        checkOwnerRole(inviterUserId);

        return R.ok(invitationService.createInvitation(
                tenantId, inviterUserId,
                req.email, req.displayName, req.permissions, req.message, req.teamIds));
    }

    /**
     * 撤销邀请。
     */
    @DeleteMapping("/{id}")
    public R<Void> revoke(@PathVariable UUID id) {
        UUID tenantId = getTenantId();
        checkOwnerRole(getUserId());
        invitationService.revoke(tenantId, id);
        return R.ok(null);
    }

    /**
     * 重发邀请。
     */
    @PostMapping("/{id}/resend")
    public R<InvitationVO> resend(@PathVariable UUID id) {
        UUID tenantId = getTenantId();
        checkOwnerRole(getUserId());
        return R.ok(invitationService.resend(tenantId, id));
    }

    // --- helpers ---

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    private UUID getUserId() {
        UUID userId = TenantContext.getUserId();
        if (userId == null) {
            throw BizException.of(401, "用户信息缺失，请重新登录");
        }
        return userId;
    }

    private void checkOwnerRole(UUID currentUserId) {
        String role = teamMapper.findRoleByTenantUserId(currentUserId);
        if (!"owner".equals(role)) {
            throw BizException.of(403, "仅主账号可执行此操作");
        }
    }

    // --- request records ---

    public record CreateInvitationReq(
            @NotBlank @Email String email,
            String displayName,
            List<String> permissions,
            String message,
            List<UUID> teamIds   // 目标团队（PRO/TRIAL 多选；FREE 忽略→默认团队）
    ) {}
}

package ai.proyubi.account.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.account.domain.MemberPermissionsVO;
import ai.proyubi.account.domain.PermissionModuleVO;
import ai.proyubi.account.domain.TeamVO;
import ai.proyubi.account.mapper.AppTeamMapper;
import ai.proyubi.account.service.AppTeamGroupService;
import ai.proyubi.account.service.AppTeamService;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/app/team")
@Validated
@RequiredArgsConstructor
public class AppTeamController {

    private final AppTeamService teamService;
    private final AppTeamGroupService teamGroupService;
    private final AppTeamMapper teamMapper;

    /**
     * 获取团队成员列表
     */
    @GetMapping("/members")
    public R<List<Map<String, Object>>> listMembers() {
        UUID tenantId = getTenantId();
        return R.ok(teamService.listMembers(tenantId));
    }

    /**
     * 移除成员（仅 owner）
     */
    @DeleteMapping("/members/{id}")
    public R<Void> removeMember(@PathVariable UUID id) {
        UUID tenantId = getTenantId();
        UUID currentUserId = getUserId();
        checkOwnerRole(currentUserId);

        teamService.removeMember(tenantId, currentUserId, id);
        return R.ok(null);
    }

    /**
     * 启用/禁用成员（仅 owner）
     */
    @PutMapping("/members/{id}/toggle")
    public R<Void> toggleMember(@PathVariable UUID id) {
        UUID tenantId = getTenantId();
        UUID currentUserId = getUserId();
        checkOwnerRole(currentUserId);

        teamService.toggleMember(tenantId, currentUserId, id);
        return R.ok(null);
    }

    /**
     * 编辑成员信息（仅 owner）
     */
    @PutMapping("/members/{id}")
    public R<Void> updateMember(@PathVariable UUID id, @RequestBody @Validated UpdateMemberReq req) {
        UUID tenantId = getTenantId();
        UUID currentUserId = getUserId();
        checkOwnerRole(currentUserId);

        teamService.updateMemberInfo(tenantId, currentUserId, id, req.displayName, req.role);
        return R.ok(null);
    }

    // ==================== 租户（团队）信息 ====================

    /**
     * 获取团队名（租户名）。team:list 成员均可读取。
     */
    @GetMapping("/tenant")
    public R<Map<String, Object>> getTenant() {
        UUID tenantId = getTenantId();
        return R.ok(Map.of("name", teamService.getTenantName(tenantId)));
    }

    /**
     * 修改团队名（租户名，仅 owner）。
     */
    @PutMapping("/tenant")
    public R<Void> updateTenant(@RequestBody @Validated UpdateTenantReq req) {
        UUID tenantId = getTenantId();
        checkOwnerRole(getUserId());

        teamService.updateTenantName(tenantId, req.name);
        return R.ok(null);
    }

    // ==================== 团队（子团队）管理 ====================

    /**
     * 当前租户团队列表（含成员数、是否默认、canCreateMore）。登录成员均可读。
     */
    @GetMapping("/teams")
    public R<List<TeamVO>> listTeams() {
        return R.ok(teamGroupService.listTeams(getTenantId()));
    }

    /**
     * 新建团队（仅 owner；套餐门控 PRO/TRIAL）。
     */
    @PostMapping("/teams")
    public R<TeamVO> createTeam(@RequestBody @Validated TeamReq req) {
        UUID tenantId = getTenantId();
        checkOwnerRole(getUserId());
        return R.ok(teamGroupService.createTeam(tenantId, req.name, req.color));
    }

    /**
     * 改名 / 改色（仅 owner）。
     */
    @PutMapping("/teams/{id}")
    public R<Void> updateTeam(@PathVariable UUID id, @RequestBody @Validated TeamReq req) {
        UUID tenantId = getTenantId();
        checkOwnerRole(getUserId());
        teamGroupService.updateTeam(tenantId, id, req.name, req.color);
        return R.ok(null);
    }

    /**
     * 删除团队（仅 owner；默认团队 / 非空团队不可删）。
     */
    @DeleteMapping("/teams/{id}")
    public R<Void> deleteTeam(@PathVariable UUID id) {
        UUID tenantId = getTenantId();
        checkOwnerRole(getUserId());
        teamGroupService.deleteTeam(tenantId, id);
        return R.ok(null);
    }

    /**
     * 团队成员列表。登录成员均可读。
     */
    @GetMapping("/teams/{id}/members")
    public R<List<Map<String, Object>>> listTeamMembers(@PathVariable UUID id) {
        return R.ok(teamGroupService.listTeamMembers(getTenantId(), id));
    }

    /**
     * 全量设置团队成员（差量增删，仅 owner）。
     */
    @PutMapping("/teams/{id}/members")
    public R<Void> setTeamMembers(@PathVariable UUID id, @RequestBody SetTeamMembersReq req) {
        UUID tenantId = getTenantId();
        checkOwnerRole(getUserId());
        teamGroupService.setTeamMembers(tenantId, id, req.userIds);
        return R.ok(null);
    }

    // ==================== 权限管理 ====================

    /**
     * 获取可分配的权限列表（按模块分组，仅 owner）
     */
    @GetMapping("/assignable-permissions")
    public R<List<PermissionModuleVO>> getAssignablePermissions() {
        UUID tenantId = getTenantId();
        UUID currentUserId = getUserId();
        checkOwnerRole(currentUserId);

        return R.ok(teamService.getAssignablePermissions(tenantId));
    }

    /**
     * 获取成员当前权限（仅 owner）
     */
    @GetMapping("/members/{id}/permissions")
    public R<MemberPermissionsVO> getMemberPermissions(@PathVariable UUID id) {
        UUID tenantId = getTenantId();
        UUID currentUserId = getUserId();
        checkOwnerRole(currentUserId);

        return R.ok(teamService.getMemberPermissions(tenantId, id));
    }

    /**
     * 更新成员权限（仅 owner）
     */
    @PutMapping("/members/{id}/permissions")
    public R<Void> updateMemberPermissions(@PathVariable UUID id,
                                           @RequestBody UpdatePermissionsReq req) {
        UUID tenantId = getTenantId();
        UUID currentUserId = getUserId();
        checkOwnerRole(currentUserId);

        teamService.updateMemberPermissions(tenantId, currentUserId, id, req.permissions);
        return R.ok(null);
    }

    // --- Helpers ---

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

    // --- Request Records ---

    public record UpdateMemberReq(
            String displayName,
            @NotBlank String role
    ) {}

    public record UpdatePermissionsReq(
            List<String> permissions  // null 表示恢复默认权限
    ) {}

    public record UpdateTenantReq(
            @NotBlank String name
    ) {}

    public record TeamReq(
            @NotBlank String name,
            String color
    ) {}

    public record SetTeamMembersReq(
            List<UUID> userIds  // 该团队期望的成员全集（差量增删）
    ) {}
}

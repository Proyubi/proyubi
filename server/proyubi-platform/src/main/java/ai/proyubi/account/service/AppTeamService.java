package ai.proyubi.account.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.account.domain.MemberPermissionsVO;
import ai.proyubi.account.domain.PermissionModuleVO;
import ai.proyubi.account.domain.PermissionModuleVO.PermissionGroupVO;
import ai.proyubi.account.domain.PermissionModuleVO.PermissionItemVO;
import ai.proyubi.account.mapper.AppTeamMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 团队管理服务
 *
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AppTeamService {

    private final AppTeamMapper teamMapper;
    private final ObjectMapper objectMapper;

    /** 本服务管理的是 WMS 模块的成员权限（= Module.WMS.code()）。③-b 模型 A：权限按模块存 module_grant。 */
    private static final String MODULE_WMS = "wms";

    /**
     * 默认 member 权限集合（与 BootstrapService.getMemberRolePermissions 保持一致）
     */
    private static final Set<String> DEFAULT_MEMBER_PERMISSIONS = Set.of(
            "app:product:list", "app:product:add", "app:product:edit",
            "app:stock:list",
            "app:transaction:list", "app:transaction:add",
            // 盘点：delete = 撤销单个商品的盘点项，是逐个商品盘点主流程的一部分，member 必须有；
            // void（作废整单）是破坏性操作，与 app:transaction:void 一样不给 member。
            "app:inventory-check:list", "app:inventory-check:add", "app:inventory-check:edit",
            "app:inventory-check:delete",
            "app:contact:list", "app:contact:add", "app:contact:edit",
            "app:expense:list", "app:expense:add",
            "app:envelope:list", "app:envelope:add", "app:envelope:edit",
            "app:envelope:transaction:add", "app:envelope:transaction:void",
            "app:team:list"
    );

    /**
     * 获取成员列表
     */
    public List<Map<String, Object>> listMembers(UUID tenantId) {
        List<Map<String, Object>> members = teamMapper.listMembersByTenantId(tenantId);

        // 各成员的所属团队（id+name），按 tenant_user_id 分组
        Map<Object, List<Map<String, Object>>> teamsByUser = new HashMap<>();
        for (Map<String, Object> row : teamMapper.listMemberTeams(tenantId)) {
            Object uid = row.get("tenantUserId");
            Map<String, Object> team = new HashMap<>();
            team.put("id", row.get("teamId"));
            team.put("name", row.get("teamName"));
            teamsByUser.computeIfAbsent(uid, k -> new ArrayList<>()).add(team);
        }

        members.forEach(member -> {
            // 主账号始终显示为启用状态
            if ("owner".equals(member.get("role"))) {
                member.put("isEnabled", true);
            }
            member.put("teams", teamsByUser.getOrDefault(member.get("id"), List.of()));
        });
        return members;
    }

    /**
     * 移除成员（软删除）
     */
    @Transactional
    public void removeMember(UUID tenantId, UUID currentUserId, UUID memberId) {
        Map<String, Object> member = teamMapper.findMemberById(memberId, tenantId);
        if (member == null) {
            throw new BizException(400, "成员不存在");
        }
        if ("owner".equals(member.get("role"))) {
            throw new BizException(400, "不能移除主账号");
        }

        // 软删除成员及其登录标识
        teamMapper.softDeleteIdentities(memberId);
        teamMapper.softDeleteMember(memberId);
    }

    /**
     * 启用/禁用成员
     */
    @Transactional
    public void toggleMember(UUID tenantId, UUID currentUserId, UUID memberId) {
        Map<String, Object> member = teamMapper.findMemberById(memberId, tenantId);
        if (member == null) {
            throw new BizException(400, "成员不存在");
        }
        if ("owner".equals(member.get("role"))) {
            throw new BizException(400, "不能禁用主账号");
        }

        Boolean isEnabled = (Boolean) member.get("isEnabled");
        boolean newEnabled = isEnabled == null || !isEnabled;

        teamMapper.updateMemberEnabled(memberId, newEnabled);
        teamMapper.updateIdentitiesEnabled(memberId, newEnabled);
    }

    /**
     * 更新成员信息（昵称、角色）
     */
    @Transactional
    public void updateMemberInfo(UUID tenantId, UUID currentUserId, UUID memberId,
                                 String displayName, String role) {
        Map<String, Object> member = teamMapper.findMemberById(memberId, tenantId);
        if (member == null) {
            throw new BizException(400, "成员不存在");
        }

        // 校验 role 值
        if (!"owner".equals(role) && !"member".equals(role)) {
            throw new BizException(400, "无效的角色");
        }

        // 不允许将自己的角色改为 member（防止没有 owner）
        if (memberId.equals(currentUserId) && "member".equals(role)) {
            throw new BizException(400, "不能将自己降级为成员");
        }

        // 先同步 PM 甘特显示名（需在改 display_name 之前比对旧值）；清空表示名时不动 pm_member.name
        if (displayName != null && !displayName.isBlank()) {
            teamMapper.syncPmMemberName(memberId, displayName);
        }
        teamMapper.updateMemberInfo(memberId, tenantId, displayName, role);
    }

    /**
     * 获取租户名称（团队名）
     */
    public String getTenantName(UUID tenantId) {
        return teamMapper.findTenantName(tenantId);
    }

    /**
     * 更新租户名称（团队名）。仅 owner 调用（权限在 controller 校验）。
     */
    @Transactional
    public void updateTenantName(UUID tenantId, String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty()) {
            throw new BizException(400, "团队名不能为空");
        }
        if (trimmed.length() > 50) {
            throw new BizException(400, "团队名不能超过 50 个字符");
        }
        teamMapper.updateTenantName(tenantId, trimmed);
    }

    // ==================== 权限管理 ====================

    /**
     * 获取可分配的权限列表（按模块→资源组分组）
     */
    public List<PermissionModuleVO> getAssignablePermissions(UUID tenantId) {
        String planCode = teamMapper.findPlanCodeByTenantId(tenantId);
        if (planCode == null) {
            planCode = "FREE";
        }

        List<Map<String, Object>> rows = teamMapper.selectAssignablePermissions(planCode);

        // 按 capability 分组
        Map<String, List<Map<String, Object>>> byCapability = new LinkedHashMap<>();
        Map<String, String> capabilityNames = new LinkedHashMap<>();
        for (Map<String, Object> row : rows) {
            String capCode = (String) row.get("capabilityCode");
            String capName = (String) row.get("capabilityName");
            byCapability.computeIfAbsent(capCode, k -> new ArrayList<>()).add(row);
            capabilityNames.putIfAbsent(capCode, capName);
        }

        List<PermissionModuleVO> modules = new ArrayList<>();
        for (Map.Entry<String, List<Map<String, Object>>> entry : byCapability.entrySet()) {
            PermissionModuleVO module = new PermissionModuleVO();
            module.setModule(entry.getKey());
            module.setModuleLabel(capabilityNames.get(entry.getKey()));

            // 按资源组分组（从 permission code 中提取，如 app:product:list → product）
            Map<String, List<Map<String, Object>>> byGroup = new LinkedHashMap<>();
            for (Map<String, Object> perm : entry.getValue()) {
                String code = (String) perm.get("permissionCode");
                String group = extractGroup(code);
                byGroup.computeIfAbsent(group, k -> new ArrayList<>()).add(perm);
            }

            List<PermissionGroupVO> groups = new ArrayList<>();
            for (Map.Entry<String, List<Map<String, Object>>> groupEntry : byGroup.entrySet()) {
                PermissionGroupVO groupVO = new PermissionGroupVO();
                groupVO.setGroup(groupEntry.getKey());
                groupVO.setGroupLabel(groupEntry.getKey()); // 前端通过 i18n 映射

                List<PermissionItemVO> items = new ArrayList<>();
                for (Map<String, Object> perm : groupEntry.getValue()) {
                    PermissionItemVO item = new PermissionItemVO();
                    item.setCode((String) perm.get("permissionCode"));
                    item.setName((String) perm.get("permissionName"));
                    item.setType((String) perm.get("permissionType"));
                    item.setAction(extractAction((String) perm.get("permissionCode")));
                    items.add(item);
                }
                groupVO.setPermissions(items);
                groups.add(groupVO);
            }
            module.setGroups(groups);
            modules.add(module);
        }

        return modules;
    }

    /**
     * 获取成员当前权限
     */
    public MemberPermissionsVO getMemberPermissions(UUID tenantId, UUID memberId) {
        Map<String, Object> member = teamMapper.findMemberById(memberId, tenantId);
        if (member == null) {
            throw new BizException(400, "成员不存在");
        }

        String customPermsJson = teamMapper.findGrantPermissions(memberId, tenantId, MODULE_WMS);

        MemberPermissionsVO vo = new MemberPermissionsVO();
        vo.setMemberId(memberId);

        if (customPermsJson != null && !customPermsJson.isBlank()) {
            try {
                List<String> perms = objectMapper.readValue(customPermsJson,
                        new TypeReference<List<String>>() {});
                vo.setCustom(true);
                vo.setPermissions(perms);
            } catch (IOException e) {
                log.warn("解析 custom_permissions 失败: {}", e.getMessage());
                vo.setCustom(false);
                vo.setPermissions(new ArrayList<>(DEFAULT_MEMBER_PERMISSIONS));
            }
        } else {
            vo.setCustom(false);
            vo.setPermissions(new ArrayList<>(DEFAULT_MEMBER_PERMISSIONS));
        }

        return vo;
    }

    /**
     * 更新成员权限
     *
     * @param permissions null 表示恢复默认权限
     */
    @Transactional
    public void updateMemberPermissions(UUID tenantId, UUID ownerUserId, UUID memberId,
                                        List<String> permissions) {
        Map<String, Object> member = teamMapper.findMemberById(memberId, tenantId);
        if (member == null) {
            throw new BizException(400, "成员不存在");
        }
        if ("owner".equals(member.get("role"))) {
            throw new BizException(400, "不能修改主账号权限");
        }

        if (permissions == null) {
            // 恢复默认：清空该成员 wms grant 的 permissions（null = 用默认集）
            teamMapper.upsertGrantPermissions(tenantId, memberId, MODULE_WMS, "member", null);
            return;
        }

        // 校验：所有权限码必须在租户可分配范围内
        String planCode = teamMapper.findPlanCodeByTenantId(tenantId);
        if (planCode == null) planCode = "FREE";
        List<Map<String, Object>> assignable = teamMapper.selectAssignablePermissions(planCode);
        Set<String> assignableCodes = assignable.stream()
                .map(r -> (String) r.get("permissionCode"))
                .collect(Collectors.toSet());

        // 允许 app:team:list（只读查看），但过滤掉其他 team 权限
        assignableCodes.add("app:team:list");

        List<String> validated = permissions.stream()
                .filter(assignableCodes::contains)
                .distinct()
                .sorted()
                .collect(Collectors.toList());

        try {
            String json = objectMapper.writeValueAsString(validated);
            teamMapper.upsertGrantPermissions(tenantId, memberId, MODULE_WMS, "member", json);
        } catch (JsonProcessingException e) {
            throw new BizException(500, "权限数据序列化失败");
        }
    }

    /**
     * 从权限代码提取资源组，如 app:product:list → product
     */
    private String extractGroup(String code) {
        String[] parts = code.split(":");
        return parts.length >= 3 ? parts[1] : code;
    }

    /**
     * 从权限代码提取动作，如 app:product:list → list
     */
    private String extractAction(String code) {
        String[] parts = code.split(":");
        return parts.length >= 3 ? parts[2] : code;
    }
}

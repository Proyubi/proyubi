package ai.proyubi.account.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.account.domain.TeamVO;
import ai.proyubi.account.mapper.AppTeamMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * 团队（子团队 / platform_team）管理服务。
 *
 * <p>「团队」是 {@code platform_tenant}（工作区/ワークスペース）内部的子分组。
 * FREE 固定 1 个默认团队；TRIAL/PRO 可多个。PM 业务数据按团队隔离。
 *
 * <p>归位说明（模型 A）：team 概念归属 <b>PM 域</b>（仅 {@code pm_customer}/{@code pm_project}
 * 带 team_id；wms_* 表无 team_id）。物理表名 {@code platform_team}/{@code platform_team_member}
 * 保留为「跨模块共享的分组载体」，此 CRUD 为历史代管入口（WMS 设置页 + PM 设置页共用
 * {@code /app/team/teams/*}），不做物理搬迁。
 * TODO：{@link #canMultiTeam} 暂仍读 WMS 套餐；per-module 订阅就绪后改读 pm grant/订阅。
 *
 * @see AppTeamService 处理租户级成员/权限/租户名
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AppTeamGroupService {

    /** 允许多团队的套餐。FREE 仅默认 1 个。 */
    private static final Set<String> MULTI_TEAM_PLANS = Set.of("PRO", "TRIAL");

    private final AppTeamMapper teamMapper;

    /** 当前套餐是否允许多团队（PRO/TRIAL）。 */
    public boolean canMultiTeam(UUID tenantId) {
        String plan = teamMapper.findPlanCodeByTenantId(tenantId);
        return plan != null && MULTI_TEAM_PLANS.contains(plan);
    }

    public List<TeamVO> listTeams(UUID tenantId) {
        boolean canCreateMore = canMultiTeam(tenantId);
        List<Map<String, Object>> rows = teamMapper.listTeamsByTenant(tenantId);
        List<TeamVO> result = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            result.add(TeamVO.from(row, canCreateMore));
        }
        return result;
    }

    @Transactional
    public TeamVO createTeam(UUID tenantId, String name, String color) {
        if (!canMultiTeam(tenantId)) {
            throw BizException.of(403, "当前套餐不支持多团队，请升级到 PRO");
        }
        String trimmed = validateName(name);
        UUID id = UUID.randomUUID();
        int sortOrder = teamMapper.countTeamsByTenant(tenantId);
        teamMapper.insertTeam(id, tenantId, trimmed, normalizeColor(color), sortOrder);
        return TeamVO.from(teamMapper.findTeamById(id, tenantId), true);
    }

    @Transactional
    public void updateTeam(UUID tenantId, UUID teamId, String name, String color) {
        requireTeam(tenantId, teamId);
        String trimmed = validateName(name);
        teamMapper.updateTeam(teamId, tenantId, trimmed, normalizeColor(color));
    }

    @Transactional
    public void deleteTeam(UUID tenantId, UUID teamId) {
        Map<String, Object> team = requireTeam(tenantId, teamId);
        if (Boolean.TRUE.equals(team.get("isDefault"))) {
            throw BizException.of(400, "默认团队不可删除");
        }
        if (teamMapper.countProjectsInTeam(teamId) > 0 || teamMapper.countCustomersInTeam(teamId) > 0) {
            throw BizException.of(400, "请先迁移或删除该团队下的项目/客户，再删除团队");
        }
        teamMapper.softDeleteTeamMembers(teamId);
        teamMapper.softDeleteTeam(teamId, tenantId);
    }

    public List<Map<String, Object>> listTeamMembers(UUID tenantId, UUID teamId) {
        requireTeam(tenantId, teamId);
        return teamMapper.listTeamMemberUsers(teamId);
    }

    /**
     * 全量设置团队成员（差量增删）。userIds=该团队期望的 tenant_user 全集。
     */
    @Transactional
    public void setTeamMembers(UUID tenantId, UUID teamId, List<UUID> userIds) {
        requireTeam(tenantId, teamId);
        Set<UUID> desired = new LinkedHashSet<>(userIds == null ? List.of() : userIds);
        for (UUID uid : desired) {
            if (teamMapper.countUserInTenant(uid, tenantId) == 0) {
                throw BizException.of(400, "成员不属于本租户");
            }
        }
        Set<UUID> current = new HashSet<>(teamMapper.listTeamMemberIds(teamId));
        for (UUID uid : desired) {
            if (!current.contains(uid)) {
                teamMapper.insertTeamMember(UUID.randomUUID(), tenantId, teamId, uid);
            }
        }
        for (UUID uid : current) {
            if (!desired.contains(uid)) {
                teamMapper.softDeleteTeamMember(teamId, uid);
            }
        }
    }

    // --- helpers ---

    private Map<String, Object> requireTeam(UUID tenantId, UUID teamId) {
        Map<String, Object> team = teamMapper.findTeamById(teamId, tenantId);
        if (team == null) {
            throw BizException.of(404, "团队不存在");
        }
        return team;
    }

    private String validateName(String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty()) {
            throw BizException.of(400, "团队名不能为空");
        }
        if (trimmed.length() > 50) {
            throw BizException.of(400, "团队名不能超过 50 个字符");
        }
        return trimmed;
    }

    private String normalizeColor(String color) {
        if (color == null) return null;
        String trimmed = color.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}

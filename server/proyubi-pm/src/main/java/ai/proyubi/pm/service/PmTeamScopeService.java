package ai.proyubi.pm.service;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.mapper.PmTenantUserMapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * PM 多团队可见域解析。
 *
 * <p>直接从 {@link TenantContext}（ThreadLocal）读取当前 tenantId / userId，
 * 因此各 Service 不必在方法签名里逐层传 userId。
 *
 * <ul>
 *   <li><b>owner</b>：可见本租户全部团队（{@link #visibleTeamIds()} 返回 {@code null} 表示不限制）。</li>
 *   <li><b>member</b>：仅 {@code platform_team_member} 里其所属团队。</li>
 * </ul>
 *
 * 历史数据 team_id 为 null 时一律视为可见，保证回填前后兼容。
 */
@Service
public class PmTeamScopeService {

    private final PmTenantUserMapper userMapper;

    public PmTeamScopeService(PmTenantUserMapper userMapper) {
        this.userMapper = userMapper;
    }

    /**
     * 当前用户可见团队。
     * <ul>
     *   <li>无用户上下文（纯机械：定时同步など、X-User-Id 未送出）→ {@code null}（不限制，租户全量）。</li>
     *   <li>owner → {@code null}（不限制）。</li>
     *   <li>member → 其所属团队（可能为空列表 = 无可见数据）。</li>
     * </ul>
     */
    public List<UUID> visibleTeamIds() {
        UUID tenantId = TenantContext.getTenantId();
        UUID userId = TenantContext.getUserId();
        if (tenantId == null || userId == null) {
            // 纯机械上下文（user なし）だけが無制限。MCP は X-User-Id を送るので画面と同じ基準で絞られる
            return null;
        }
        if ("owner".equals(userMapper.findRole(tenantId, userId))) {
            return null;
        }
        return userMapper.listTeamIds(tenantId, userId);
    }

    /**
     * 列表过滤用团队集合：合并显式 teamId 与可见域。
     * 返回 {@code null}=不过滤（owner 且未指定）；空列表=无可见数据；否则限定这些团队。
     */
    public List<UUID> resolveFilterTeamIds(UUID explicitTeamId) {
        List<UUID> visible = visibleTeamIds();
        if (explicitTeamId != null) {
            if (visible != null && !visible.contains(explicitTeamId)) {
                return List.of();
            }
            return List.of(explicitTeamId);
        }
        return visible;
    }

    /**
     * 断言某团队对当前用户可见，否则 404。owner 恒可见；team_id 为 null（历史数据）放行。
     */
    public void assertTeamVisible(UUID teamId) {
        List<UUID> visible = visibleTeamIds();
        if (visible == null || teamId == null) {
            return;
        }
        if (!visible.contains(teamId)) {
            throw BizException.of(404, "无权访问该团队的数据");
        }
    }

    /**
     * 断言当前用户是本租户 owner（用于节假日等租户级配置的写操作门禁）。
     * 无用户上下文（纯机械，如定时同步）放行；member 抛 403（MCP も X-User-Id があれば同じ門禁）。
     */
    public void assertOwner() {
        UUID tenantId = TenantContext.getTenantId();
        UUID userId = TenantContext.getUserId();
        if (tenantId == null || userId == null) {
            return;   // 机械/内部上下文（定时任务）不做角色门禁
        }
        if (!"owner".equals(userMapper.findRole(tenantId, userId))) {
            throw BizException.of(403, "仅管理员可执行该操作");
        }
    }

    public UUID defaultTeamId() {
        UUID tenantId = TenantContext.getTenantId();
        return tenantId == null ? null : userMapper.findDefaultTeamId(tenantId);
    }

    /**
     * 解析写入团队（客户创建用）。
     * 指定了 teamId → 校验归属本租户且对当前用户可见；未指定 → member 的唯一团队，否则默认团队。
     */
    public UUID resolveWriteTeamId(UUID requestedTeamId) {
        UUID tenantId = TenantContext.getTenantId();
        if (requestedTeamId != null) {
            if (tenantId == null || userMapper.countTeamInTenant(tenantId, requestedTeamId) == 0) {
                throw BizException.of(400, "团队不存在");
            }
            assertTeamVisible(requestedTeamId);
            return requestedTeamId;
        }
        List<UUID> visible = visibleTeamIds();
        if (visible != null && visible.size() == 1) {
            return visible.get(0);
        }
        return defaultTeamId();
    }
}

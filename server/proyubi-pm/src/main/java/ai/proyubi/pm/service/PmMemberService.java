package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.mapper.PmMemberMapper;
import ai.proyubi.pm.mapper.PmTenantUserMapper;
import ai.proyubi.pm.vo.PmTenantUserVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 团队成员Service（PM）。
 * PM 成员绑定到 platform_tenant_user，与 WMS 共用同一套租户账户。
 *
 */
@Service
public class PmMemberService {

    private static final Logger log = LoggerFactory.getLogger(PmMemberService.class);

    private final PmMemberMapper memberMapper;
    private final PmTenantUserMapper tenantUserMapper;

    public PmMemberService(PmMemberMapper memberMapper, PmTenantUserMapper tenantUserMapper) {
        this.memberMapper = memberMapper;
        this.tenantUserMapper = tenantUserMapper;
    }

    /**
     * 列出当前租户的全部成员。
     * 列表前先做一次"自动同步"：把该租户下尚未加入 PM 的启用中租户用户补建成 PM 成员，
     * 这样团队管理里的人（含当前登录用户）天然出现在担当下拉里，无需手动"拉人进来"。
     */
    @Transactional
    public List<PmMember> list(UUID tenantId) {
        syncFromTenantUsers(tenantId);
        List<PmMember> members = memberMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmMember::getTenantId).eq(tenantId)
                .and(PmMember::getDeletedAt).isNull()
                .orderBy(PmMember::getCreatedAt, true)
        );
        // 排查「登录后担当显示成 UUID」：定位是 tenant 不一致还是 list 本身为空。复现后可删。
        log.warn("PM members list: tenant={}, count={}", tenantId, members.size());
        return members;
    }

    /** 头像/甘特着色默认色板，按成员序号轮转取色 */
    private static final String[] DEFAULT_COLORS = {
        "#1677ff", "#52c41a", "#fa8c16", "#722ed1", "#eb2f96",
        "#13c2c2", "#f5222d", "#2f54eb", "#a0d911", "#fa541c"
    };

    /**
     * 把租户下「有 pm grant」、尚未绑定 PM 成员的启用中用户补建成 PM 成员（幂等）。
     * 仅新增缺失的人，不动已存在 / 已软删除的成员。
     * 模型 A（③-c）：成员名册收敛到有 pm grant 的人，与 PM 准入网关同源——
     * 无 pm grant 的用户不会被自动拉进 PM 担当下拉。
     */
    private void syncFromTenantUsers(UUID tenantId) {
        Set<UUID> boundUserIds = memberMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmMember::getTenantId).eq(tenantId)
                    .and(PmMember::getUserId).isNotNull()
                    .and(PmMember::getDeletedAt).isNull()
            ).stream()
            .map(PmMember::getUserId)
            .collect(Collectors.toSet());

        long existing = boundUserIds.size();
        List<PmTenantUserVO> users = tenantUserMapper.listPmMembersByTenant(tenantId);
        int idx = 0;
        for (PmTenantUserVO user : users) {
            if (boundUserIds.contains(user.getId())) {
                continue;
            }
            PmMember member = new PmMember();
            member.setId(UUID.randomUUID());
            member.setTenantId(tenantId);
            member.setUserId(user.getId());
            member.setName(user.getDisplayName());
            member.setColor(DEFAULT_COLORS[(int) ((existing + idx) % DEFAULT_COLORS.length)]);
            member.setRole(user.getRole());
            member.setCreatedAt(LocalDateTime.now());
            member.setUpdatedAt(LocalDateTime.now());
            memberMapper.insert(member);
            idx++;
        }
    }

    /**
     * 列出当前租户中尚未加入 PM 的租户用户（供"拉人进来"选择）。
     * 模型 A（③-c）：候选收敛到有 pm grant 的用户（「能被指派」⊆「能进 PM」），
     * 无 pm grant 的人不出现在候选里。
     */
    public List<PmTenantUserVO> listAvailableTenantUsers(UUID tenantId) {
        Set<UUID> boundUserIds = memberMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmMember::getTenantId).eq(tenantId)
                    .and(PmMember::getUserId).isNotNull()
                    .and(PmMember::getDeletedAt).isNull()
            ).stream()
            .map(PmMember::getUserId)
            .collect(Collectors.toSet());

        return tenantUserMapper.listPmMembersByTenant(tenantId).stream()
            .filter(u -> !boundUserIds.contains(u.getId()))
            .collect(Collectors.toList());
    }

    public PmMember getByIdAndTenant(UUID id, UUID tenantId) {
        PmMember member = memberMapper.selectOneById(id);
        if (member == null || !member.getTenantId().equals(tenantId) || member.getDeletedAt() != null) {
            throw BizException.of(404, "成员不存在");
        }
        return member;
    }

    /**
     * 从租户用户创建 PM 成员档案。
     * userId 必须属于当前租户且未被绑定；name 为空时默认取该用户 display_name。
     */
    @Transactional
    public PmMember create(UUID tenantId, UUID userId, String name, String color, String role) {
        PmTenantUserVO user = tenantUserMapper.listPmMembersByTenant(tenantId).stream()
            .filter(u -> u.getId().equals(userId))
            .findFirst()
            .orElseThrow(() -> BizException.of(400, "用户不属于当前租户、已停用或未开通 PM"));

        long bound = memberMapper.selectCountByQuery(
            QueryWrapper.create()
                .where(PmMember::getTenantId).eq(tenantId)
                .and(PmMember::getUserId).eq(userId)
                .and(PmMember::getDeletedAt).isNull()
        );
        if (bound > 0) {
            throw BizException.of(409, "该用户已是 PM 成员");
        }

        PmMember member = new PmMember();
        member.setId(UUID.randomUUID());
        member.setTenantId(tenantId);
        member.setUserId(userId);
        member.setName((name == null || name.isBlank()) ? user.getDisplayName() : name);
        member.setColor(color);
        member.setRole(role);
        member.setCreatedAt(LocalDateTime.now());
        member.setUpdatedAt(LocalDateTime.now());
        memberMapper.insert(member);
        return member;
    }

    /** 编辑 PM 成员的甘特显示名 / 颜色 / 角色（不改租户用户绑定） */
    @Transactional
    public PmMember update(UUID id, UUID tenantId, String name, String color, String role) {
        PmMember member = getByIdAndTenant(id, tenantId);
        if (name != null && !name.isBlank()) {
            member.setName(name);
        }
        member.setColor(color);
        member.setRole(role);
        member.setUpdatedAt(LocalDateTime.now());
        memberMapper.update(member);
        return member;
    }

    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmMember member = getByIdAndTenant(id, tenantId);
        member.setDeletedAt(LocalDateTime.now());
        member.setUpdatedAt(LocalDateTime.now());
        memberMapper.update(member);
    }
}

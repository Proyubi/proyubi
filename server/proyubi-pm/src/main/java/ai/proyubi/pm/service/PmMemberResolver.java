package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.mapper.PmMemberMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

/**
 * 当前登录用户 → PM 成员（pm_member）解析。
 * <p>
 * 收口原先散落在 PmEventService / PmCommentService / PmOverviewService 三处、各写一遍的
 * 「按 tenant + user + deleted_at 取首条成员」逻辑（隐含「一用户一成员」假设），消除口径漂移。
 *
 */
@Service
public class PmMemberResolver {

    private final PmMemberMapper memberMapper;

    public PmMemberResolver(PmMemberMapper memberMapper) {
        this.memberMapper = memberMapper;
    }

    /** 某租户下某用户对应的有效 PM 成员（未绑定/未登录返回 null）。 */
    public PmMember findMember(UUID tenantId, UUID userId) {
        if (userId == null) {
            return null;
        }
        List<PmMember> members = memberMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmMember::getTenantId).eq(tenantId)
                .and(PmMember::getUserId).eq(userId)
                .and(PmMember::getDeletedAt).isNull());
        return members.isEmpty() ? null : members.get(0);
    }

    /** 同 {@link #findMember}，返回成员 id 字符串（未绑定返回 null）。 */
    public String memberId(UUID tenantId, UUID userId) {
        PmMember m = findMember(tenantId, userId);
        return m == null ? null : m.getId().toString();
    }
}

package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmComment;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.mapper.PmCommentMapper;
import ai.proyubi.pm.mapper.PmTenantUserMapper;
import ai.proyubi.pm.vo.PmCommentVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 任务评论Service（PM）。
 * 评论挂在任务上，发帖人解析自当前登录用户 → pm_member（取头像色/显示名）。
 * 编辑/删除仅限本人（authorUserId 与当前用户一致）。
 *
 */
@Service
public class PmCommentService {

    private final PmCommentMapper commentMapper;
    private final PmTaskService taskService;
    private final PmMemberResolver memberResolver;
    private final PmTenantUserMapper tenantUserMapper;

    public PmCommentService(PmCommentMapper commentMapper, PmTaskService taskService,
                            PmMemberResolver memberResolver, PmTenantUserMapper tenantUserMapper) {
        this.commentMapper = commentMapper;
        this.taskService = taskService;
        this.memberResolver = memberResolver;
        this.tenantUserMapper = tenantUserMapper;
    }

    /** 列出某任务的全部评论（按发帖时间升序），附带 mine 标记。 */
    public List<PmCommentVO> list(UUID tenantId, UUID taskId, UUID currentUserId) {
        taskService.getVisibleTask(taskId, tenantId); // 任务须属于本租户且团队可见
        return commentMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmComment::getTenantId).eq(tenantId)
                    .and(PmComment::getTaskId).eq(taskId)
                    .and(PmComment::getDeletedAt).isNull()
                    .orderBy(PmComment::getCreatedAt, true)
            ).stream()
            .map(c -> PmCommentVO.of(c, currentUserId))
            .toList();
    }

    /** 发表评论。content 不可空白；发帖人显示名/成员从当前用户解析并定格快照。 */
    @Transactional
    public PmCommentVO create(UUID tenantId, UUID taskId, UUID userId, String content) {
        if (content == null || content.isBlank()) {
            throw BizException.of(400, "评论内容不能为空");
        }
        taskService.getVisibleTask(taskId, tenantId); // 任务须属于本租户且团队可见

        PmMember member = memberResolver.findMember(tenantId, userId);
        PmComment c = new PmComment();
        c.setId(UUID.randomUUID());
        c.setTenantId(tenantId);
        c.setTaskId(taskId);
        c.setAuthorUserId(userId);
        c.setAuthorMemberId(member != null ? member.getId() : null);
        c.setAuthorName(resolveAuthorName(tenantId, userId, member));
        c.setContent(content.trim());
        c.setCreatedAt(LocalDateTime.now());
        c.setUpdatedAt(LocalDateTime.now());
        commentMapper.insert(c);
        return PmCommentVO.of(c, userId);
    }

    /** 编辑自己的评论正文。 */
    @Transactional
    public PmCommentVO update(UUID id, UUID tenantId, UUID userId, String content) {
        if (content == null || content.isBlank()) {
            throw BizException.of(400, "评论内容不能为空");
        }
        PmComment c = getOwn(id, tenantId, userId);
        c.setContent(content.trim());
        c.setUpdatedAt(LocalDateTime.now());
        commentMapper.update(c);
        return PmCommentVO.of(c, userId);
    }

    /** 软删除自己的评论。 */
    @Transactional
    public void delete(UUID id, UUID tenantId, UUID userId) {
        PmComment c = getOwn(id, tenantId, userId);
        c.setDeletedAt(LocalDateTime.now());
        c.setUpdatedAt(LocalDateTime.now());
        commentMapper.update(c);
    }

    /** 取本人的评论；不存在 / 非本租户 → 404；非本人 → 403。 */
    private PmComment getOwn(UUID id, UUID tenantId, UUID userId) {
        PmComment c = commentMapper.selectOneById(id);
        if (c == null || !c.getTenantId().equals(tenantId) || c.getDeletedAt() != null) {
            throw BizException.of(404, "评论不存在");
        }
        if (userId == null || !userId.equals(c.getAuthorUserId())) {
            throw BizException.of(403, "只能操作自己的评论");
        }
        return c;
    }

    /** 发帖人显示名：优先 PM 成员名，否则回退租户用户 display_name（单行查），再否则「—」。 */
    private String resolveAuthorName(UUID tenantId, UUID userId, PmMember member) {
        if (member != null && member.getName() != null && !member.getName().isBlank()) {
            return member.getName();
        }
        if (userId != null) {
            String name = tenantUserMapper.findDisplayName(tenantId, userId);
            if (name != null && !name.isBlank()) {
                return name;
            }
        }
        return "—";
    }
}

package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmTaskLink;
import ai.proyubi.pm.mapper.PmTaskLinkMapper;
import ai.proyubi.pm.vo.PmTaskLinkVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * 任务关联链接Service（PM）。
 * 链接挂在任务上，指向外部资料（首版主打 Figma 设计稿）。
 * kind 由 url 域名服务端判定（前端不可信）；删除为任意本租户成员可操作（共享上下文）。
 *
 */
@Service
public class PmTaskLinkService {

    /** title 最大长度，避免异常长输入 */
    private static final int MAX_TITLE = 200;
    /** url 最大长度 */
    private static final int MAX_URL = 2000;

    private final PmTaskLinkMapper linkMapper;
    private final PmTaskService taskService;

    public PmTaskLinkService(PmTaskLinkMapper linkMapper, PmTaskService taskService) {
        this.linkMapper = linkMapper;
        this.taskService = taskService;
    }

    /** 列出某任务的全部链接（按添加时间升序）。 */
    public List<PmTaskLinkVO> list(UUID tenantId, UUID taskId) {
        taskService.getVisibleTask(taskId, tenantId); // 任务须属于本租户且团队可见
        return linkMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmTaskLink::getTenantId).eq(tenantId)
                    .and(PmTaskLink::getTaskId).eq(taskId)
                    .and(PmTaskLink::getDeletedAt).isNull()
                    .orderBy(PmTaskLink::getCreatedAt, true)
            ).stream()
            .map(PmTaskLinkVO::of)
            .toList();
    }

    /** 新增链接。url 必填且须为 http(s)；kind 按域名服务端判定。 */
    @Transactional
    public PmTaskLinkVO create(UUID tenantId, UUID taskId, UUID userId, String url, String title) {
        String normalizedUrl = normalizeUrl(url);
        taskService.getVisibleTask(taskId, tenantId); // 任务须属于本租户且团队可见

        PmTaskLink l = new PmTaskLink();
        l.setId(UUID.randomUUID());
        l.setTenantId(tenantId);
        l.setTaskId(taskId);
        l.setKind(detectKind(normalizedUrl));
        l.setUrl(normalizedUrl);
        l.setTitle(normalizeTitle(title));
        l.setCreatedBy(userId);
        l.setCreatedAt(LocalDateTime.now());
        linkMapper.insert(l);
        return PmTaskLinkVO.of(l);
    }

    /** 软删除链接（任意本租户成员可操作）。 */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmTaskLink l = linkMapper.selectOneById(id);
        if (l == null || !tenantId.equals(l.getTenantId()) || l.getDeletedAt() != null) {
            throw BizException.of(404, "链接不存在");
        }
        taskService.getVisibleTask(l.getTaskId(), tenantId); // 所属任务须团队可见，防跨团队越权删除
        l.setDeletedAt(LocalDateTime.now());
        linkMapper.update(l);
    }

    /** 校验并规整 url：非空、http(s)、长度限制。 */
    private String normalizeUrl(String url) {
        if (url == null || url.isBlank()) {
            throw BizException.of(400, "链接不能为空");
        }
        String u = url.trim();
        String lower = u.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            throw BizException.of(400, "链接必须以 http:// 或 https:// 开头");
        }
        if (u.length() > MAX_URL) {
            throw BizException.of(400, "链接过长");
        }
        return u;
    }

    private String normalizeTitle(String title) {
        if (title == null) {
            return null;
        }
        String t = title.trim();
        if (t.isEmpty()) {
            return null;
        }
        return t.length() > MAX_TITLE ? t.substring(0, MAX_TITLE) : t;
    }

    /** 按 url 域名判定 kind：figma 域 → figma（前端内联预览）；其余 → link。 */
    private String detectKind(String url) {
        String lower = url.toLowerCase(Locale.ROOT);
        if (lower.contains("figma.com/") || lower.contains(".figma.com")) {
            return "figma";
        }
        return "link";
    }
}

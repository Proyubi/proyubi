package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmMindmap;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.mapper.PmMindmapMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 思维导图 Service（PM）。
 * - 一张导图整棵节点树存 jsonb（content），前端整读整写；
 * - 保存采用 version 乐观锁：传入 version 与库内不一致 → 抛 409，前端提示刷新；
 * - 软删除；租户隔离。
 *
 */
@Service
public class PmMindmapService {

    /** 新图默认节点树（前端通常会覆盖；保证 content 永不为 null） */
    private static final String DEFAULT_CONTENT =
        "{\"root\":{\"id\":\"root\",\"text\":\"中心主题\",\"children\":[]}}";
    private static final String DEFAULT_THEME = "classic";

    private final PmMindmapMapper mindmapMapper;
    private final PmProjectMapper projectMapper;

    public PmMindmapService(PmMindmapMapper mindmapMapper, PmProjectMapper projectMapper) {
        this.mindmapMapper = mindmapMapper;
        this.projectMapper = projectMapper;
    }

    /** 列出当前租户全部导图（摘要：清空 content，避免大字段进列表）。 */
    public List<PmMindmap> list(UUID tenantId) {
        List<PmMindmap> rows = mindmapMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmMindmap::getTenantId).eq(tenantId)
                .and(PmMindmap::getDeletedAt).isNull()
                .orderBy(PmMindmap::getUpdatedAt, false)
        );
        for (PmMindmap m : rows) {
            m.setContent(null);
        }
        return rows;
    }

    public PmMindmap getByIdAndTenant(UUID id, UUID tenantId) {
        PmMindmap m = mindmapMapper.selectOneById(id);
        if (m == null || !tenantId.equals(m.getTenantId()) || m.getDeletedAt() != null) {
            throw BizException.of(404, "思维导图不存在");
        }
        return m;
    }

    @Transactional
    public PmMindmap create(UUID tenantId, String name, UUID projectId, String theme, String content) {
        if (name == null || name.isBlank()) {
            throw BizException.of(400, "导图名不能为空");
        }
        if (projectId != null) {
            requireProject(projectId, tenantId);
        }
        PmMindmap m = new PmMindmap();
        m.setId(UUID.randomUUID());
        m.setTenantId(tenantId);
        m.setProjectId(projectId);
        m.setName(name.trim());
        m.setTheme(theme != null && !theme.isBlank() ? theme : DEFAULT_THEME);
        m.setContent(content != null && !content.isBlank() ? content : DEFAULT_CONTENT);
        m.setVersion(1);
        LocalDateTime now = LocalDateTime.now();
        m.setCreatedAt(now);
        m.setUpdatedAt(now);
        mindmapMapper.insert(m);
        return m;
    }

    /**
     * 更新导图。content/theme/name/projectId 均为可选（null=不变）。
     * 当带 content 保存时必须携带 version 做乐观锁；version 与库内不一致抛 409。
     * 成功后 version +1 并返回最新实体。
     */
    @Transactional
    public PmMindmap update(UUID id, UUID tenantId, String name, UUID projectId,
                            Boolean clearProject, String theme, String content, Integer version) {
        PmMindmap m = getByIdAndTenant(id, tenantId);

        // 仅当带 content（实质内容保存）时校验乐观锁；纯改名/换主题不阻塞
        if (content != null && version != null && !version.equals(m.getVersion())) {
            throw BizException.of(409, "该导图已被他人更新，请刷新后再保存");
        }

        if (name != null && !name.isBlank()) {
            m.setName(name.trim());
        }
        if (Boolean.TRUE.equals(clearProject)) {
            m.setProjectId(null);
        } else if (projectId != null) {
            requireProject(projectId, tenantId);
            m.setProjectId(projectId);
        }
        if (theme != null && !theme.isBlank()) {
            m.setTheme(theme);
        }
        if (content != null) {
            m.setContent(content);
            m.setVersion((m.getVersion() == null ? 0 : m.getVersion()) + 1);
        }
        m.setUpdatedAt(LocalDateTime.now());

        // projectId 置空需走 UpdateChain（MyBatis-Flex 默认忽略 null）
        if (Boolean.TRUE.equals(clearProject)) {
            com.mybatisflex.core.update.UpdateChain.of(PmMindmap.class)
                .set(PmMindmap::getProjectId, null)
                .where(PmMindmap::getId).eq(id)
                .update();
        }
        mindmapMapper.update(m);
        return m;
    }

    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmMindmap m = getByIdAndTenant(id, tenantId);
        LocalDateTime now = LocalDateTime.now();
        m.setDeletedAt(now);
        m.setUpdatedAt(now);
        mindmapMapper.update(m);
    }

    private void requireProject(UUID projectId, UUID tenantId) {
        PmProject p = projectMapper.selectOneById(projectId);
        if (p == null || !tenantId.equals(p.getTenantId()) || p.getDeletedAt() != null) {
            throw BizException.of(404, "关联项目不存在");
        }
    }
}

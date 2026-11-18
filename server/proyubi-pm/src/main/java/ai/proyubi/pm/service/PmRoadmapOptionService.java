package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmRoadmapOption;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmRoadmapOptionMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 路线图可自定义字典Service（PM）。
 * 管理租户级的「泳道(lane)」「里程碑色(ms_color)」字典，取代前端写死的枚举/顺序/颜色。
 *
 */
@Service
public class PmRoadmapOptionService {

    /** 合法用途 */
    private static final Set<String> KINDS = Set.of("lane", "ms_color");

    private final PmRoadmapOptionMapper optionMapper;
    private final PmTaskMapper taskMapper;

    public PmRoadmapOptionService(PmRoadmapOptionMapper optionMapper, PmTaskMapper taskMapper) {
        this.optionMapper = optionMapper;
        this.taskMapper = taskMapper;
    }

    /** 列出当前租户的字典项（租户级全局，project_id is null），可按 kind 过滤；按 sort_order 升序。 */
    public List<PmRoadmapOption> list(UUID tenantId, String kind) {
        QueryWrapper q = QueryWrapper.create()
            .where(PmRoadmapOption::getTenantId).eq(tenantId)
            .and(PmRoadmapOption::getProjectId).isNull()
            .and(PmRoadmapOption::getDeletedAt).isNull();
        if (kind != null && !kind.isBlank()) {
            q.and(PmRoadmapOption::getKind).eq(kind);
        }
        q.orderBy(PmRoadmapOption::getKind, true).orderBy(PmRoadmapOption::getSortOrder, true);
        return optionMapper.selectListByQuery(q);
    }

    public PmRoadmapOption getByIdAndTenant(UUID id, UUID tenantId) {
        PmRoadmapOption opt = optionMapper.selectOneById(id);
        if (opt == null || !opt.getTenantId().equals(tenantId) || opt.getDeletedAt() != null) {
            throw BizException.of(404, "字典项不存在");
        }
        return opt;
    }

    /** 新增自定义字典项。option_key 由后端生成，租户内唯一。 */
    @Transactional
    public PmRoadmapOption create(UUID tenantId, String kind, String label, String color, Integer sortOrder) {
        if (kind == null || !KINDS.contains(kind)) {
            throw BizException.of(400, "非法的字典类型");
        }
        if (label == null || label.isBlank()) {
            throw BizException.of(400, "名称不能为空");
        }
        PmRoadmapOption opt = new PmRoadmapOption();
        opt.setId(UUID.randomUUID());
        opt.setTenantId(tenantId);
        opt.setProjectId(null);
        opt.setKind(kind);
        opt.setOptionKey("opt_" + UUID.randomUUID().toString().substring(0, 8));
        opt.setLabel(label.trim());
        opt.setColor(color);
        opt.setSortOrder(sortOrder != null ? sortOrder : nextSortOrder(tenantId, kind));
        opt.setIsSystem(false);
        opt.setCreatedAt(LocalDateTime.now());
        opt.setUpdatedAt(LocalDateTime.now());
        optionMapper.insert(opt);
        return opt;
    }

    /** 编辑字典项的名称 / 颜色 / 排序（系统项也允许改这三项，但不可删）。 */
    @Transactional
    public PmRoadmapOption update(UUID id, UUID tenantId, String label, String color, Integer sortOrder) {
        PmRoadmapOption opt = getByIdAndTenant(id, tenantId);
        if (label != null && !label.isBlank()) {
            opt.setLabel(label.trim());
        }
        opt.setColor(color);
        if (sortOrder != null) {
            opt.setSortOrder(sortOrder);
        }
        opt.setUpdatedAt(LocalDateTime.now());
        optionMapper.update(opt);
        return opt;
    }

    /** 软删除自定义字典项。系统项拒绝；仍被任务引用时拒绝（避免路线图出现无定义 key）。 */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmRoadmapOption opt = getByIdAndTenant(id, tenantId);
        if (Boolean.TRUE.equals(opt.getIsSystem())) {
            throw BizException.of(400, "系统内置项不可删除（可改名/改色/排序）");
        }
        if (referencedCount(tenantId, opt) > 0) {
            throw BizException.of(409, "该项仍被任务引用，无法删除");
        }
        opt.setDeletedAt(LocalDateTime.now());
        opt.setUpdatedAt(LocalDateTime.now());
        optionMapper.update(opt);
    }

    /** 拖动排序：按给定顺序重写同一 kind 下字典项的 sort_order（0..n-1）。 */
    @Transactional
    public void reorder(UUID tenantId, String kind, List<UUID> orderedIds) {
        if (orderedIds == null || orderedIds.isEmpty()) {
            return;
        }
        LocalDateTime now = LocalDateTime.now();
        int order = 0;
        for (UUID id : orderedIds) {
            PmRoadmapOption opt = optionMapper.selectOneById(id);
            if (opt == null || opt.getDeletedAt() != null
                || !tenantId.equals(opt.getTenantId())
                || opt.getProjectId() != null
                || (kind != null && !kind.equals(opt.getKind()))) {
                continue;
            }
            opt.setSortOrder(order++);
            opt.setUpdatedAt(now);
            optionMapper.update(opt);
        }
    }

    /** 给路线图渲染用：返回当前租户全部字典项（已按 kind + sort_order 排序）。 */
    public List<PmRoadmapOption> loadForRoadmap(UUID tenantId) {
        return list(tenantId, null);
    }

    /** 某 kind 下当前最大 sort_order + 1（空则 0）。 */
    private int nextSortOrder(UUID tenantId, String kind) {
        return list(tenantId, kind).stream()
            .map(o -> o.getSortOrder() != null ? o.getSortOrder() : 0)
            .max(Integer::compareTo)
            .map(m -> m + 1)
            .orElse(0);
    }

    /** 该字典项的 option_key 被多少个未删任务引用（lane → roadmap_lane；ms_color → milestone_color）。 */
    private long referencedCount(UUID tenantId, PmRoadmapOption opt) {
        QueryWrapper q = QueryWrapper.create()
            .where(PmTask::getTenantId).eq(tenantId)
            .and(PmTask::getDeletedAt).isNull();
        if ("ms_color".equals(opt.getKind())) {
            q.and(PmTask::getMilestoneColor).eq(opt.getOptionKey());
        } else {
            q.and(PmTask::getRoadmapLane).eq(opt.getOptionKey());
        }
        return taskMapper.selectCountByQuery(q);
    }
}

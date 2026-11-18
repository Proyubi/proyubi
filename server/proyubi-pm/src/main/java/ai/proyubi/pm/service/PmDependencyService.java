package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmDependency;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmDependencyMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 任务依赖Service（PM）。首版仅 Finish-to-Start。
 *
 */
@Service
public class PmDependencyService {

    private final PmDependencyMapper dependencyMapper;
    private final PmTaskService taskService;
    private final PmTaskActivityService activityService;

    public PmDependencyService(PmDependencyMapper dependencyMapper, PmTaskService taskService,
                               PmTaskActivityService activityService) {
        this.dependencyMapper = dependencyMapper;
        this.taskService = taskService;
        this.activityService = activityService;
    }

    public List<PmDependency> listByProject(UUID tenantId, UUID projectId) {
        return dependencyMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmDependency::getTenantId).eq(tenantId)
                .and(PmDependency::getProjectId).eq(projectId)
                .and(PmDependency::getDeletedAt).isNull()
                .orderBy(PmDependency::getCreatedAt, true)
        );
    }

    @Transactional
    public PmDependency create(UUID tenantId, UUID projectId, UUID predecessorId, UUID successorId,
                               String type, Integer lag) {
        if (predecessorId.equals(successorId)) {
            throw BizException.of(400, "前序任务与后续任务不能相同");
        }
        // type 仅支持 Finish-to-Start
        if (type != null && !"FS".equals(type)) {
            throw BizException.of(400, "暂仅支持 Finish-to-Start(FS) 依赖");
        }
        // 校验两个任务都存在、属于同一项目与租户
        PmTask predecessor = requireTask(predecessorId, tenantId);
        PmTask successor = requireTask(successorId, tenantId);
        if (!predecessor.getProjectId().equals(projectId) || !successor.getProjectId().equals(projectId)) {
            throw BizException.of(400, "依赖的任务必须属于同一项目");
        }
        // 去重：同一对前后序不重复
        PmDependency existing = dependencyMapper.selectOneByQuery(
            QueryWrapper.create()
                .where(PmDependency::getTenantId).eq(tenantId)
                .and(PmDependency::getPredecessorId).eq(predecessorId)
                .and(PmDependency::getSuccessorId).eq(successorId)
                .and(PmDependency::getDeletedAt).isNull()
                .limit(1)
        );
        if (existing != null) {
            throw BizException.of(409, "该依赖已存在");
        }
        // 环检测：新增边 predecessor→successor 后，若 successor 沿现存依赖可达 predecessor 即成环
        if (wouldFormCycle(tenantId, projectId, predecessorId, successorId)) {
            throw BizException.of(400, "该依赖会形成环");
        }

        PmDependency dependency = new PmDependency();
        dependency.setId(UUID.randomUUID());
        dependency.setTenantId(tenantId);
        dependency.setProjectId(projectId);
        dependency.setPredecessorId(predecessorId);
        dependency.setSuccessorId(successorId);
        dependency.setType("FS");
        dependency.setLag(lag);
        dependency.setCreatedAt(LocalDateTime.now());
        dependency.setUpdatedAt(LocalDateTime.now());
        dependencyMapper.insert(dependency);
        // 先行/後続の両タスクの操作履歴に残す（どちらのドロワーからも経緯が読める）
        activityService.recordDependency(tenantId, projectId, predecessor, successor, true);
        return dependency;
    }

    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmDependency dependency = dependencyMapper.selectOneById(id);
        if (dependency == null || !dependency.getTenantId().equals(tenantId) || dependency.getDeletedAt() != null) {
            throw BizException.of(404, "依赖不存在");
        }
        PmTask predecessor = requireTask(dependency.getPredecessorId(), tenantId);
        PmTask successor = requireTask(dependency.getSuccessorId(), tenantId);
        dependency.setDeletedAt(LocalDateTime.now());
        dependency.setUpdatedAt(LocalDateTime.now());
        dependencyMapper.update(dependency);
        activityService.recordDependency(tenantId, dependency.getProjectId(), predecessor, successor, false);
    }

    private PmTask requireTask(UUID id, UUID tenantId) {
        // 经 getVisibleTask 取任务：校验租户归属 + 所属项目团队可见性（防跨团队越权建依赖）
        return taskService.getVisibleTask(id, tenantId);
    }

    /**
     * 判断新增依赖边 predecessor→successor 是否会形成环：
     * 在现存未删依赖（同项目）构成的有向图上，从 successorId 出发沿 predecessor→successor 方向
     * BFS，若能到达 predecessorId，则加入新边后成环。
     */
    private boolean wouldFormCycle(UUID tenantId, UUID projectId, UUID predecessorId, UUID successorId) {
        List<PmDependency> deps = listByProject(tenantId, projectId);
        Map<UUID, List<UUID>> adj = new HashMap<>();
        for (PmDependency d : deps) {
            if (d.getPredecessorId() != null && d.getSuccessorId() != null) {
                adj.computeIfAbsent(d.getPredecessorId(), k -> new ArrayList<>()).add(d.getSuccessorId());
            }
        }
        Set<UUID> seen = new HashSet<>();
        Deque<UUID> queue = new ArrayDeque<>();
        queue.add(successorId);
        seen.add(successorId);
        while (!queue.isEmpty()) {
            UUID cur = queue.poll();
            if (cur.equals(predecessorId)) {
                return true;
            }
            for (UUID next : adj.getOrDefault(cur, List.of())) {
                if (seen.add(next)) {
                    queue.add(next);
                }
            }
        }
        return false;
    }
}

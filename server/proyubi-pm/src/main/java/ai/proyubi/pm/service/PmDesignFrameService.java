package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmDesign;
import ai.proyubi.pm.domain.PmDesignComment;
import ai.proyubi.pm.domain.PmDesignFrame;
import ai.proyubi.pm.domain.PmDesignFrameTask;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmDesignCommentMapper;
import ai.proyubi.pm.mapper.PmDesignFrameMapper;
import ai.proyubi.pm.mapper.PmDesignFrameTaskMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import ai.proyubi.pm.vo.PmDesignFrameVO;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * .pen 画框Service：画框一覧、審査ステータス、タスク紐付け。
 * 可視性・操作者の検証は {@link PmDesignService} と同じ（案件が見えるメンバー全員が操作できる）。
 * ステータスと紐付けは画框（node_id）単位で版をまたいで保持し、流程板の画面からも同じ値を参照する。
 *
 */
@Service
public class PmDesignFrameService {

    public static final Set<String> STATUSES = Set.of("draft", "review", "changes", "approved");

    private final PmDesignService designService;
    private final PmDesignFrameMapper frameMapper;
    private final PmDesignFrameTaskMapper frameTaskMapper;
    private final PmDesignCommentMapper commentMapper;
    private final PmTaskMapper taskMapper;
    private final PmTaskService taskService;

    public PmDesignFrameService(PmDesignService designService, PmDesignFrameMapper frameMapper,
                                PmDesignFrameTaskMapper frameTaskMapper, PmDesignCommentMapper commentMapper,
                                PmTaskMapper taskMapper, PmTaskService taskService) {
        this.designService = designService;
        this.frameMapper = frameMapper;
        this.frameTaskMapper = frameTaskMapper;
        this.commentMapper = commentMapper;
        this.taskMapper = taskMapper;
        this.taskService = taskService;
    }

    /** 設計の画框一覧（removed 含む、原文の並び順）。.pen 以外は空。 */
    public List<PmDesignFrameVO> list(UUID designId, UUID tenantId) {
        PmDesign d = designService.requireVisible(designId, tenantId);
        if (!PmDesignContent.FORMAT_PEN.equals(d.getFormat())) {
            return List.of();
        }
        List<PmDesignFrame> frames = frameMapper.selectByDesign(tenantId, designId);
        Map<String, List<PmDesignFrameTask>> links = new HashMap<>();
        for (PmDesignFrameTask l : frameTaskMapper.selectByDesign(tenantId, designId)) {
            links.computeIfAbsent(l.getNodeId(), k -> new ArrayList<>()).add(l);
        }
        Map<String, Integer> open = openCommentCounts(tenantId, designId);
        Map<UUID, PmTask> tasks = liveTasks(tenantId, links.values().stream().flatMap(List::stream)
            .map(PmDesignFrameTask::getTaskId).toList());
        return frames.stream().map(f -> toVO(d, f, links.getOrDefault(f.getNodeId(), List.of()), tasks,
            open.getOrDefault(f.getNodeId(), 0))).toList();
    }

    /** タスクに紐付いた画框（タスク詳細のデザイン欄）。設計が削除済み・不可視のものは除く。 */
    public List<PmDesignFrameVO> listByTask(UUID taskId, UUID tenantId) {
        taskService.getVisibleTask(taskId, tenantId);
        Map<UUID, List<PmDesignFrameTask>> byDesign = new LinkedHashMap<>();
        for (PmDesignFrameTask l : frameTaskMapper.selectByTask(tenantId, taskId)) {
            byDesign.computeIfAbsent(l.getDesignId(), k -> new ArrayList<>()).add(l);
        }
        List<PmDesignFrameVO> out = new ArrayList<>();
        for (Map.Entry<UUID, List<PmDesignFrameTask>> e : byDesign.entrySet()) {
            PmDesign d;
            try {
                d = designService.requireVisible(e.getKey(), tenantId);
            } catch (BizException ex) {
                continue;
            }
            Map<String, PmDesignFrame> frames = new HashMap<>();
            for (PmDesignFrame f : frameMapper.selectByDesign(tenantId, d.getId())) {
                frames.put(f.getNodeId(), f);
            }
            Map<String, Integer> open = openCommentCounts(tenantId, d.getId());
            for (PmDesignFrameTask l : e.getValue()) {
                PmDesignFrame f = frames.get(l.getNodeId());
                if (f != null) {
                    out.add(toVO(d, f, List.of(), Map.of(), open.getOrDefault(f.getNodeId(), 0)));
                }
            }
        }
        return out;
    }

    @Transactional
    public PmDesignFrameVO setStatus(UUID designId, String nodeId, UUID tenantId, UUID userId, String status) {
        designService.requireActor(tenantId, userId);
        requireFrame(designId, nodeId, tenantId);
        if (status == null || !STATUSES.contains(status)) {
            throw BizException.of(400, "status は draft / review / changes / approved のいずれかです");
        }
        frameMapper.setStatus(tenantId, designId, nodeId, status, userId, designService.userName(tenantId, userId));
        return one(designId, nodeId, tenantId);
    }

    @Transactional
    public PmDesignFrameVO linkTask(UUID designId, String nodeId, UUID tenantId, UUID userId, UUID taskId) {
        designService.requireActor(tenantId, userId);
        PmDesign d = requireFrame(designId, nodeId, tenantId);
        if (taskId == null) {
            throw BizException.of(400, "taskId を指定してください");
        }
        PmTask t = taskService.getVisibleTask(taskId, tenantId);
        if (!d.getProjectId().equals(t.getProjectId())) {
            throw BizException.of(400, "同じ案件のタスクにのみ紐付けできます");
        }
        frameTaskMapper.link(tenantId, designId, nodeId, taskId, userId, designService.userName(tenantId, userId));
        return one(designId, nodeId, tenantId);
    }

    @Transactional
    public PmDesignFrameVO unlinkTask(UUID designId, String nodeId, UUID tenantId, UUID userId, UUID taskId) {
        designService.requireActor(tenantId, userId);
        requireFrame(designId, nodeId, tenantId);
        frameTaskMapper.unlink(tenantId, designId, nodeId, taskId);
        return one(designId, nodeId, tenantId);
    }

    private PmDesignFrameVO one(UUID designId, String nodeId, UUID tenantId) {
        return list(designId, tenantId).stream().filter(f -> f.nodeId().equals(nodeId)).findFirst()
            .orElseThrow(() -> BizException.of(404, "画框が存在しません"));
    }

    private PmDesign requireFrame(UUID designId, String nodeId, UUID tenantId) {
        PmDesign d = designService.requireVisible(designId, tenantId);
        if (nodeId == null || frameMapper.selectOne(tenantId, designId, nodeId) == null) {
            throw BizException.of(404, "画框が存在しません");
        }
        return d;
    }

    private Map<String, Integer> openCommentCounts(UUID tenantId, UUID designId) {
        Map<String, Integer> open = new HashMap<>();
        for (PmDesignComment c : commentMapper.selectLive(tenantId, designId, null)) {
            if (c.getElementId() != null && !Boolean.TRUE.equals(c.getResolved())) {
                open.merge(c.getElementId(), 1, Integer::sum);
            }
        }
        return open;
    }

    private Map<UUID, PmTask> liveTasks(UUID tenantId, List<UUID> ids) {
        Map<UUID, PmTask> map = new HashMap<>();
        List<UUID> distinct = ids.stream().filter(Objects::nonNull).distinct().toList();
        if (distinct.isEmpty()) {
            return map;
        }
        for (PmTask t : taskMapper.selectListByIds(distinct)) {
            if (t.getDeletedAt() == null && tenantId.equals(t.getTenantId())) {
                map.put(t.getId(), t);
            }
        }
        return map;
    }

    private static PmDesignFrameVO toVO(PmDesign d, PmDesignFrame f, List<PmDesignFrameTask> links,
                                        Map<UUID, PmTask> tasks, int openComments) {
        List<PmDesignFrameVO.TaskRef> refs = links.stream().map(l -> tasks.get(l.getTaskId()))
            .filter(Objects::nonNull)
            .map(t -> new PmDesignFrameVO.TaskRef(t.getId(), t.getName(), t.getStatus())).toList();
        return new PmDesignFrameVO(d.getId(), d.getTitle(), f.getNodeId(), f.getName(), f.getSortOrder(),
            f.getReviewStatus(), f.getStatusByName(), f.getStatusAt(), f.getLastRevision(),
            Boolean.TRUE.equals(f.getRemoved()), refs, openComments);
    }
}

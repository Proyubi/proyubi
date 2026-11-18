package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmEvent;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.mapper.PmEventMapper;
import ai.proyubi.pm.mapper.PmMemberMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.vo.PmEventVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 事件/会议日程Service（PM · 迭代二）。
 * <p>
 * CRUD 照 PmCommentService 范式；list 区间相交查询 + scope=me 按 attendee 过滤 +
 * 有 project_id 的事件走 {@link PmTeamScopeService} 团队可见性（全局事件 project_id null
 * 对全租户可见），与 PmOverviewService 同口径。
 * <p>
 * 事件独立于 pm_task：不进 WBS / TaskRollupService / 进度汇总。
 *
 */
@Service
public class PmEventService {

    /** 合法事件种别 */
    private static final Set<String> TYPES = Set.of("meeting", "review", "milestone", "deadline", "other");

    private final PmEventMapper eventMapper;
    private final PmProjectMapper projectMapper;
    private final PmMemberMapper memberMapper;
    private final PmTeamScopeService teamScope;
    private final PmMemberResolver memberResolver;
    private final PmTaskService taskService;

    public PmEventService(PmEventMapper eventMapper, PmProjectMapper projectMapper,
                          PmMemberMapper memberMapper, PmTeamScopeService teamScope,
                          PmMemberResolver memberResolver, PmTaskService taskService) {
        this.eventMapper = eventMapper;
        this.projectMapper = projectMapper;
        this.memberMapper = memberMapper;
        this.teamScope = teamScope;
        this.memberResolver = memberResolver;
        this.taskService = taskService;
    }

    /**
     * 列出 [from, to] 区间内相交的事件。
     *
     * @param scope "all"=全员（默认）；"me"=仅本人在 attendee_ids
     */
    public List<PmEventVO> list(UUID tenantId, UUID userId, String scope, LocalDate from, LocalDate to) {
        boolean meScope = "me".equalsIgnoreCase(scope);
        String meMemberId = resolveMeMemberId(tenantId, userId);
        if (meScope && meMemberId == null) {
            return List.of();
        }

        // 项目 map（用于项目名 + 团队可见性）
        Map<UUID, PmProject> projectMap = new HashMap<>();
        for (PmProject p : projectMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getDeletedAt).isNull())) {
            projectMap.put(p.getId(), p);
        }
        // 多团队隔离：member 仅看可见团队的项目（team_id 为 null 的历史项目视为可见）
        List<UUID> visibleTeams = teamScope.visibleTeamIds();
        if (visibleTeams != null) {
            Set<UUID> allowTeams = new HashSet<>(visibleTeams);
            projectMap.values().removeIf(p -> p.getTeamId() != null && !allowTeams.contains(p.getTeamId()));
        }
        Set<UUID> allowedProjectIds = projectMap.keySet();
        boolean teamLimited = visibleTeams != null;

        // 区间相交：start_at < toEnd（含 to 当天整天） AND coalesce(end_at, start_at) >= fromStart
        LocalDateTime fromStart = from.atStartOfDay();
        LocalDateTime toEnd = to.plusDays(1).atStartOfDay();

        List<PmEvent> events = eventMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmEvent::getTenantId).eq(tenantId)
                .and(PmEvent::getDeletedAt).isNull()
                .and(PmEvent::getStartAt).lt(toEnd));

        List<PmEventVO> out = new ArrayList<>();
        for (PmEvent e : events) {
            // 区间相交下界：coalesce(end_at, start_at) >= fromStart
            LocalDateTime effEnd = e.getEndAt() != null ? e.getEndAt() : e.getStartAt();
            if (effEnd != null && effEnd.isBefore(fromStart)) {
                continue;
            }
            // 团队可见性：有 project_id 的事件须落在可见项目内；全局事件（null）始终保留
            if (teamLimited && e.getProjectId() != null && !allowedProjectIds.contains(e.getProjectId())) {
                continue;
            }
            // me 视角：本人须在 attendee_ids 内
            if (meScope && (e.getAttendeeIds() == null || !e.getAttendeeIds().contains(meMemberId))) {
                continue;
            }
            String projectName = e.getProjectId() != null && projectMap.containsKey(e.getProjectId())
                ? projectMap.get(e.getProjectId()).getName() : null;
            out.add(PmEventVO.of(e, projectName));
        }
        return out;
    }

    /** 新建事件。title/type 校验；带 projectId 时校验团队可见性。 */
    @Transactional
    public PmEventVO create(UUID tenantId, UUID userId, EventInput req) {
        if (req.title() == null || req.title().isBlank()) {
            throw BizException.of(400, "标题不能为空");
        }
        validateType(req.type());
        if (req.startAt() == null) {
            throw BizException.of(400, "开始时间不能为空");
        }
        validateTimeRange(req.startAt(), req.endAt());

        UUID projectId = parseUuid(req.projectId());
        assertProjectVisible(tenantId, projectId);
        UUID taskId = parseUuid(req.taskId());
        assertTaskVisible(tenantId, taskId);

        PmEvent e = new PmEvent();
        e.setId(UUID.randomUUID());
        e.setTenantId(tenantId);
        e.setProjectId(projectId);
        e.setTaskId(taskId);
        e.setTitle(req.title().trim());
        e.setType(req.type());
        e.setStartAt(req.startAt());
        e.setEndAt(req.endAt());
        e.setAllDay(req.allDay() != null && req.allDay());
        e.setAttendeeIds(sanitizeAttendees(tenantId, req.attendeeIds()));
        e.setLocation(req.location());
        e.setNote(req.note());
        e.setCreatedBy(userId);
        e.setCreatedAt(LocalDateTime.now());
        e.setUpdatedAt(LocalDateTime.now());
        eventMapper.insert(e);
        return PmEventVO.of(e, projectName(tenantId, projectId));
    }

    /** 更新事件（删除/编辑不限本人，仅校 tenant 归属）。 */
    @Transactional
    public PmEventVO update(UUID id, UUID tenantId, EventInput req) {
        if (req.title() == null || req.title().isBlank()) {
            throw BizException.of(400, "标题不能为空");
        }
        validateType(req.type());
        if (req.startAt() == null) {
            throw BizException.of(400, "开始时间不能为空");
        }
        validateTimeRange(req.startAt(), req.endAt());
        PmEvent e = getOwned(id, tenantId);

        UUID projectId = parseUuid(req.projectId());
        assertProjectVisible(tenantId, projectId);
        UUID taskId = parseUuid(req.taskId());
        assertTaskVisible(tenantId, taskId);

        e.setProjectId(projectId);
        e.setTaskId(taskId);
        e.setTitle(req.title().trim());
        e.setType(req.type());
        e.setStartAt(req.startAt());
        e.setEndAt(req.endAt());
        e.setAllDay(req.allDay() != null && req.allDay());
        e.setAttendeeIds(sanitizeAttendees(tenantId, req.attendeeIds()));
        e.setLocation(req.location());
        e.setNote(req.note());
        e.setUpdatedAt(LocalDateTime.now());
        eventMapper.update(e);
        return PmEventVO.of(e, projectName(tenantId, projectId));
    }

    /** 软删除事件。 */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmEvent e = getOwned(id, tenantId);
        e.setDeletedAt(LocalDateTime.now());
        e.setUpdatedAt(LocalDateTime.now());
        eventMapper.update(e);
    }

    /** 取本租户事件；不存在 / 非本租户 / 已删 → 404（删除/编辑不限本人）。 */
    private PmEvent getOwned(UUID id, UUID tenantId) {
        PmEvent e = eventMapper.selectOneById(id);
        if (e == null || !tenantId.equals(e.getTenantId()) || e.getDeletedAt() != null) {
            throw BizException.of(404, "事件不存在");
        }
        return e;
    }

    /** 当前登录用户对应的 pm_member.id（未绑定/未登录返回 null）。统一走 PmMemberResolver。 */
    private String resolveMeMemberId(UUID tenantId, UUID userId) {
        return memberResolver.memberId(tenantId, userId);
    }

    /** 带 taskId 时校验任务属本租户且其项目对当前用户团队可见（防越权挂载/跳转线索造假）。 */
    private void assertTaskVisible(UUID tenantId, UUID taskId) {
        if (taskId != null) {
            taskService.getVisibleTask(taskId, tenantId);
        }
    }

    /**
     * 规整参加者：剔除非法 UUID / 非本租户有效成员的 id，保留输入顺序并去重。
     * 空/null 原样返回（无参加者）。
     */
    private List<String> sanitizeAttendees(UUID tenantId, List<String> attendeeIds) {
        if (attendeeIds == null || attendeeIds.isEmpty()) {
            return attendeeIds;
        }
        Set<UUID> ids = new HashSet<>();
        for (String s : attendeeIds) {
            try {
                if (s != null && !s.isBlank()) {
                    ids.add(UUID.fromString(s.trim()));
                }
            } catch (IllegalArgumentException ignore) {
                // 非法 UUID → 剔除
            }
        }
        if (ids.isEmpty()) {
            return List.of();
        }
        Set<String> valid = memberMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmMember::getTenantId).eq(tenantId)
                    .and(PmMember::getId).in(new ArrayList<>(ids))
                    .and(PmMember::getDeletedAt).isNull())
            .stream().map(m -> m.getId().toString()).collect(Collectors.toSet());
        return attendeeIds.stream().filter(valid::contains).distinct().toList();
    }

    private void validateType(String type) {
        if (type == null || !TYPES.contains(type)) {
            throw BizException.of(400, "事件种别不合法");
        }
    }

    /** 结束时刻不可早于开始时刻（endAt 为空=单点事件，放行）。 */
    private void validateTimeRange(LocalDateTime startAt, LocalDateTime endAt) {
        if (endAt != null && endAt.isBefore(startAt)) {
            throw BizException.of(400, "结束时间不能早于开始时间");
        }
    }

    private UUID parseUuid(String s) {
        if (s == null || s.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(s.trim());
        } catch (IllegalArgumentException ex) {
            throw BizException.of(400, "ID 格式不合法");
        }
    }

    /** 带 projectId 时校验项目属本租户且对当前用户团队可见。 */
    private void assertProjectVisible(UUID tenantId, UUID projectId) {
        if (projectId == null) {
            return;
        }
        PmProject p = projectMapper.selectOneById(projectId);
        if (p == null || !tenantId.equals(p.getTenantId()) || p.getDeletedAt() != null) {
            throw BizException.of(404, "项目不存在");
        }
        teamScope.assertTeamVisible(p.getTeamId());
    }

    private String projectName(UUID tenantId, UUID projectId) {
        if (projectId == null) {
            return null;
        }
        PmProject p = projectMapper.selectOneById(projectId);
        return p != null && tenantId.equals(p.getTenantId()) ? p.getName() : null;
    }

    /**
     * 新建/更新事件入参（与 Controller 的 EventReq 解耦的内部载体）。
     * projectId/taskId 为 UUID 字符串（可空），service 内转 UUID；时间为 LocalDateTime。
     */
    public record EventInput(
        String title,
        String type,
        LocalDateTime startAt,
        LocalDateTime endAt,
        Boolean allDay,
        String projectId,
        String taskId,
        List<String> attendeeIds,
        String location,
        String note
    ) {
    }
}

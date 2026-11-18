package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmCustomer;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmCustomerMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import ai.proyubi.pm.vo.PmWorkloadItemVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 成员负载Service（PM，跨项目）。
 * 取租户内所有有指派的任务（可按 memberId 过滤），并拼上所属项目/客户名。
 *
 */
@Service
public class PmWorkloadService {

    private final PmTaskMapper taskMapper;
    private final PmProjectMapper projectMapper;
    private final PmCustomerMapper customerMapper;
    private final PmTeamScopeService teamScope;
    private final PmHolidayService holidayService;
    private final PmSettingService settingService;

    public PmWorkloadService(PmTaskMapper taskMapper, PmProjectMapper projectMapper,
                             PmCustomerMapper customerMapper, PmTeamScopeService teamScope,
                             PmHolidayService holidayService, PmSettingService settingService) {
        this.taskMapper = taskMapper;
        this.projectMapper = projectMapper;
        this.customerMapper = customerMapper;
        this.teamScope = teamScope;
        this.holidayService = holidayService;
        this.settingService = settingService;
    }

    /** 跨项目成员负载：所有有指派的任务（带项目/客户名），可选按成员过滤 */
    public List<PmWorkloadItemVO> workload(UUID tenantId, String memberId) {
        QueryWrapper query = QueryWrapper.create()
            .where(PmTask::getTenantId).eq(tenantId)
            .and(PmTask::getDeletedAt).isNull()
            // 仅含有指派的任务（PG：数组非空）
            .and("array_length(assignee_ids, 1) > 0");
        if (memberId != null && !memberId.isBlank()) {
            // 按成员过滤：{memberId} = ANY(assignee_ids)
            // memberId 必须是合法 UUID（assignee_ids 存的就是成员 UUID 字符串）；
            // 用 UUID 解析校验，规范化后只含 [0-9a-f-]，杜绝原生 SQL 拼接注入。
            String safe;
            try {
                safe = UUID.fromString(memberId.trim()).toString();
            } catch (IllegalArgumentException e) {
                throw BizException.of(400, "memberId 格式不正确");
            }
            query.and("'" + safe + "' = ANY(assignee_ids)");
        }
        query.orderBy(PmTask::getStart, true);
        List<PmTask> tasks = taskMapper.selectListByQuery(query);
        if (tasks.isEmpty()) {
            return List.of();
        }

        // 批量取项目/客户名
        List<UUID> projectIds = tasks.stream()
            .map(PmTask::getProjectId)
            .filter(java.util.Objects::nonNull)
            .distinct()
            .collect(Collectors.toList());
        Map<UUID, PmProject> projectMap = new HashMap<>();
        if (!projectIds.isEmpty()) {
            for (PmProject p : projectMapper.selectListByQuery(
                QueryWrapper.create().where(PmProject::getId).in(projectIds)
                    .and(PmProject::getTenantId).eq(tenantId)
                    .and(PmProject::getDeletedAt).isNull())) {
                projectMap.put(p.getId(), p);
            }
        }

        // 多团队隔离：member 仅保留可见团队的项目（team_id 为 null 的历史项目视为可见）
        List<UUID> visibleTeams = teamScope.visibleTeamIds();
        if (visibleTeams != null) {
            java.util.Set<UUID> allowTeams = new java.util.HashSet<>(visibleTeams);
            projectMap.values().removeIf(p -> p.getTeamId() != null && !allowTeams.contains(p.getTeamId()));
        }

        List<UUID> customerIds = projectMap.values().stream()
            .map(PmProject::getCustomerId)
            .filter(java.util.Objects::nonNull)
            .distinct()
            .collect(Collectors.toList());
        Map<UUID, PmCustomer> customerMap = new HashMap<>();
        if (!customerIds.isEmpty()) {
            for (PmCustomer c : customerMapper.selectListByQuery(
                QueryWrapper.create().where(PmCustomer::getId).in(customerIds)
                    .and(PmCustomer::getTenantId).eq(tenantId)
                    .and(PmCustomer::getDeletedAt).isNull())) {
                customerMap.put(c.getId(), c);
            }
        }

        // 工時実績サマリー用：予定/実績工期（分）を 1 タスクずつ算出。
        // 口径は TaskRollupService（甘特 footer / projectEffortTotals と同一）：
        // 予定＝予定套で算出（milestone=0）；実績＝着手あり（両端そろう or 手动d/h）のみ計上、未着手=0。
        java.util.Set<java.time.LocalDate> holidays = holidayService.getHolidayDates(tenantId);
        double hoursPerDay = settingService.getHoursPerWorkday(tenantId);

        List<PmWorkloadItemVO> items = new ArrayList<>(tasks.size());
        for (PmTask t : tasks) {
            PmProject project = t.getProjectId() != null ? projectMap.get(t.getProjectId()) : null;
            // 受限视角下，项目已被过滤掉的任务（属于不可见团队）直接跳过
            if (visibleTeams != null && project == null) {
                continue;
            }
            PmCustomer customer = project != null && project.getCustomerId() != null
                ? customerMap.get(project.getCustomerId()) : null;

            boolean milestone = "milestone".equals(t.getType());
            long plannedMinutes = milestone ? 0L
                : TaskRollupService.effortForSet(t.getStart(), t.getEnd(),
                    t.getPlannedEffortDays(), t.getPlannedEffortHours(), holidays, hoursPerDay);
            boolean actualValid = !milestone
                && t.getActualStart() != null
                && (t.getActualEnd() != null
                    || TaskRollupService.manualEffort(t.getActualEffortDays(), t.getActualEffortHours()));
            long actualMinutes = 0L;
            if (actualValid) {
                // 着手中（終了なし）は手动路径のみ到達＝end 未使用だが null 回避で開始日を代入
                java.time.LocalDate ae = t.getActualEnd() != null ? t.getActualEnd() : t.getActualStart();
                actualMinutes = TaskRollupService.effortForSet(t.getActualStart(), ae,
                    t.getActualEffortDays(), t.getActualEffortHours(), holidays, hoursPerDay);
            }

            items.add(new PmWorkloadItemVO(
                t.getId().toString(),
                t.getName(),
                t.getType(),
                t.getProjectId() != null ? t.getProjectId().toString() : null,
                project != null ? project.getName() : null,
                customer != null ? customer.getId().toString() : null,
                customer != null ? customer.getName() : null,
                t.getAssigneeIds() != null ? t.getAssigneeIds() : List.of(),
                t.getStart() != null ? t.getStart().toString() : null,
                t.getEnd() != null ? t.getEnd().toString() : null,
                t.getProgress() != null ? t.getProgress() : 0,
                t.getActualStart() != null ? t.getActualStart().toString() : null,
                t.getActualEnd() != null ? t.getActualEnd().toString() : null,
                plannedMinutes,
                actualMinutes
            ));
        }
        return items;
    }
}

package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.update.UpdateChain;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * プロジェクト進捗キャッシュ（{@code pm_project.progress}）の再計算。サブプロジェクト対応版。
 * <ul>
 *   <li>サブを持たない案件：従来どおり自分のタスクの rollup（{@link TaskRollupService#projectProgress}）。</li>
 *   <li>サブを持つ親：{@link TaskRollupService#parentProgress}＝サブ（予定工数で加重）＋親直下タスクの加重平均。</li>
 *   <li>サブの進捗が変わったら親も再計算して書き戻す（親の updated_at は触らない＝派生値の訂正）。</li>
 * </ul>
 * {@link PmTaskService}（タスク増減・更新）と {@link PmProjectService}（サブの作成/削除/付け替え/期間変更、一覧の自己修復）
 * の両方から呼ばれる。循環依存を避けるため、ここはマッパーと集計サービスにだけ依存する。
 */
@Service
public class PmProjectProgressService {

    private final PmProjectMapper projectMapper;
    private final PmTaskMapper taskMapper;
    private final TaskRollupService rollupService;
    private final PmHolidayService holidayService;
    private final PmSettingService settingService;

    public PmProjectProgressService(PmProjectMapper projectMapper, PmTaskMapper taskMapper,
                                    TaskRollupService rollupService, PmHolidayService holidayService,
                                    PmSettingService settingService) {
        this.projectMapper = projectMapper;
        this.taskMapper = taskMapper;
        this.rollupService = rollupService;
        this.holidayService = holidayService;
        this.settingService = settingService;
    }

    /**
     * 案件の進捗を再計算して書き戻す（updated_at も更新＝従来の recomputeProjectProgress と同じ）。
     * 親なら集計分岐、サブなら自分を書いたあと親も再計算する。
     */
    @Transactional
    public void recompute(UUID tenantId, UUID projectId) {
        PmProject project = load(tenantId, projectId);
        if (project == null) {
            return;
        }
        Set<LocalDate> holidays = holidayService.getHolidayDates(tenantId);
        double hoursPerDay = settingService.getHoursPerWorkday(tenantId);
        int live = liveProgress(tenantId, project, holidays, hoursPerDay);
        project.setProgress(live);
        project.setUpdatedAt(LocalDateTime.now());
        projectMapper.update(project);
        if (project.getParentId() != null) {
            recomputeParent(tenantId, project.getParentId(), holidays, hoursPerDay);
        }
    }

    /** 親だけ再計算（サブの作成/削除/付け替え/期間変更時）。parentId が null・無効なら何もしない。 */
    @Transactional
    public void recomputeParent(UUID tenantId, UUID parentId) {
        if (parentId == null) {
            return;
        }
        recomputeParent(tenantId, parentId, holidayService.getHolidayDates(tenantId),
            settingService.getHoursPerWorkday(tenantId));
    }

    private void recomputeParent(UUID tenantId, UUID parentId, Set<LocalDate> holidays, double hoursPerDay) {
        PmProject parent = load(tenantId, parentId);
        if (parent == null) {
            return;
        }
        int live = liveProgress(tenantId, parent, holidays, hoursPerDay);
        int cached = parent.getProgress() != null ? parent.getProgress() : 0;
        if (live != cached) {
            UpdateChain.of(PmProject.class)
                .set(PmProject::getProgress, live)
                .where(PmProject::getId).eq(parentId)
                .update();
        }
    }

    /**
     * 甘特を開いたとき（{@link PmTaskService#listByProject}）の自己修復用：
     * 既に rollup 済みの自分のタスクを渡すと、親なら集計値、そうでなければ自分の rollup 値を返す。
     */
    public int liveProgressWithOwnTasks(UUID tenantId, PmProject project, List<PmTask> ownTasks,
                                        Set<LocalDate> holidays, double hoursPerDay) {
        List<PmProject> children = children(tenantId, project.getId());
        if (children.isEmpty()) {
            return rollupService.projectProgress(ownTasks, holidays, hoursPerDay);
        }
        Map<UUID, List<PmTask>> byProject = tasksByProject(tenantId, ids(children));
        return rollupService.parentProgress(ownTasks,
            subWeights(children, byProject, holidays, hoursPerDay), holidays, hoursPerDay);
    }

    /** 書き込みなし：DB から読み直して現在の正しい進捗を返す。 */
    int liveProgress(UUID tenantId, PmProject project, Set<LocalDate> holidays, double hoursPerDay) {
        List<PmProject> children = project.getParentId() == null
            ? children(tenantId, project.getId()) : List.of();
        List<UUID> ids = ids(children);
        ids.add(project.getId());
        Map<UUID, List<PmTask>> byProject = tasksByProject(tenantId, ids);
        List<PmTask> own = byProject.getOrDefault(project.getId(), new ArrayList<>());
        if (children.isEmpty()) {
            return rollupService.projectProgress(own, holidays, hoursPerDay);
        }
        return rollupService.parentProgress(own,
            subWeights(children, byProject, holidays, hoursPerDay), holidays, hoursPerDay);
    }

    /**
     * サブごとの（重み, 実時間の進捗）。サブの進捗はキャッシュではなく自分のタスクから実時間で計算する
     * （キャッシュが漂流していても親が正しくなるように）。{@code byProject} のタスクは rollup で書き換わる。
     */
    List<TaskRollupService.WeightedProgress> subWeights(Collection<PmProject> children,
                                                        Map<UUID, List<PmTask>> byProject,
                                                        Set<LocalDate> holidays, double hoursPerDay) {
        List<TaskRollupService.WeightedProgress> out = new ArrayList<>(children.size());
        for (PmProject c : children) {
            List<PmTask> tasks = byProject.getOrDefault(c.getId(), new ArrayList<>());
            int progress = rollupService.projectProgress(tasks, holidays, hoursPerDay);
            long weight = rollupService.subProjectWeight(c.getStart(), c.getEnd(), tasks, holidays, hoursPerDay);
            out.add(new TaskRollupService.WeightedProgress(weight, progress));
        }
        return out;
    }

    /** 未削除のサブ一覧（同一テナント）。 */
    public List<PmProject> children(UUID tenantId, UUID parentId) {
        return projectMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getParentId).eq(parentId)
                .and(PmProject::getDeletedAt).isNull()
        );
    }

    /** 未削除のサブ件数。 */
    public long childCount(UUID tenantId, UUID parentId) {
        return projectMapper.selectCountByQuery(
            QueryWrapper.create()
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getParentId).eq(parentId)
                .and(PmProject::getDeletedAt).isNull()
        );
    }

    private Map<UUID, List<PmTask>> tasksByProject(UUID tenantId, List<UUID> projectIds) {
        Map<UUID, List<PmTask>> byProject = new HashMap<>();
        if (projectIds.isEmpty()) {
            return byProject;
        }
        List<PmTask> all = taskMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTask::getTenantId).eq(tenantId)
                .and(PmTask::getProjectId).in(projectIds)
                .and(PmTask::getDeletedAt).isNull()
                .orderBy(PmTask::getOrder, true)
        );
        for (PmTask t : all) {
            byProject.computeIfAbsent(t.getProjectId(), k -> new ArrayList<>()).add(t);
        }
        return byProject;
    }

    private PmProject load(UUID tenantId, UUID projectId) {
        PmProject project = projectMapper.selectOneById(projectId);
        if (project == null || !tenantId.equals(project.getTenantId()) || project.getDeletedAt() != null) {
            return null;
        }
        return project;
    }

    private static List<UUID> ids(Collection<PmProject> projects) {
        List<UUID> ids = new ArrayList<>(projects.size() + 1);
        for (PmProject p : projects) {
            ids.add(p.getId());
        }
        return ids;
    }
}

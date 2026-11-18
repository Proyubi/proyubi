package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.domain.PmProject;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.List;

/** Read-only activity signal, independent of rounded progress or project delivery. */
final class PmProjectActivityRules {
    private PmProjectActivityRules() {}

    /** Existing project hierarchy is exactly one level; never modify persisted status. */
    static void populate(List<PmProject> projects, List<PmTask> tasks) {
        Map<UUID, List<PmTask>> byProject = tasks.stream()
            .collect(Collectors.groupingBy(PmTask::getProjectId));
        Map<UUID, PmProject> byId = projects.stream()
            .collect(Collectors.toMap(PmProject::getId, p -> p));
        for (PmProject p : projects) {
            p.setHasStartedWork(hasStartedWork(byProject.getOrDefault(p.getId(), List.of())));
        }
        for (PmProject p : projects) {
            PmProject parent = byId.get(p.getParentId());
            if (parent != null && Boolean.TRUE.equals(p.getHasStartedWork())) {
                parent.setHasStartedWork(true);
            }
        }
    }

    static boolean hasStartedWork(List<PmTask> tasks) {
        return tasks.stream().anyMatch(t -> t.getDeletedAt() == null
            && "task".equals(t.getType())
            && ("in_progress".equals(t.getStatus())
                || "testing".equals(t.getStatus()) || "done".equals(t.getStatus())));
    }
}

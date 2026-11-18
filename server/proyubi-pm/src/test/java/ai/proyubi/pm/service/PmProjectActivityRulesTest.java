package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

class PmProjectActivityRulesTest {
    private PmTask task(String type, String status) {
        PmTask t = new PmTask();
        t.setId(UUID.randomUUID()); t.setType(type); t.setStatus(status); t.setProgress(0);
        return t;
    }
    private PmProject project(UUID parentId) {
        PmProject p = new PmProject();
        p.setId(UUID.randomUUID()); p.setParentId(parentId); p.setStatus("planned"); p.setProgress(0);
        return p;
    }
    @Test void startedStatesCountEvenWithZeroProgress() {
        for (String status : List.of("in_progress", "testing", "done")) {
            assertTrue(PmProjectActivityRules.hasStartedWork(List.of(task("task", status))), status);
        }
    }
    @Test void untouchedCancelledAndStructuralRowsDoNotCount() {
        for (String status : List.of("backlog", "todo", "cancelled")) {
            assertFalse(PmProjectActivityRules.hasStartedWork(List.of(task("task", status))), status);
        }
        assertFalse(PmProjectActivityRules.hasStartedWork(List.of(task("summary", "in_progress"), task("milestone", "done"))));
        assertFalse(PmProjectActivityRules.hasStartedWork(List.of()));
    }
    @Test void deletedTasksDoNotCount() {
        PmTask t = task("task", "in_progress"); t.setDeletedAt(LocalDateTime.now());
        assertFalse(PmProjectActivityRules.hasStartedWork(List.of(t)));
    }
    @Test void nestedWbsTaskCountsWithoutUsingSummaryStatus() {
        PmTask t = task("task", "testing"); t.setParentId(UUID.randomUUID());
        assertTrue(PmProjectActivityRules.hasStartedWork(List.of(t)));
    }
    @Test void propagatesSubprojectActivityWithoutChangingSiblingOrStoredStatus() {
        PmProject parent = project(null), child = project(parent.getId()), sibling = project(parent.getId());
        PmTask t = task("task", "in_progress"); t.setProjectId(child.getId());
        PmProjectActivityRules.populate(List.of(parent, child, sibling), List.of(t));
        assertTrue(parent.getHasStartedWork()); assertTrue(child.getHasStartedWork()); assertFalse(sibling.getHasStartedWork());
        assertEquals("planned", parent.getStatus()); assertEquals(0, parent.getProgress());
        // Recomputing clears the old transient flag when the final started task is removed.
        PmProjectActivityRules.populate(List.of(parent, child, sibling), List.of());
        assertFalse(parent.getHasStartedWork()); assertFalse(child.getHasStartedWork());
    }
    @Test void ownTasksCountEvenWhenProjectHasChildren() {
        PmProject parent = project(null), child = project(parent.getId());
        PmTask t = task("task", "testing"); t.setProjectId(parent.getId());
        PmProjectActivityRules.populate(List.of(parent, child), List.of(t));
        assertTrue(parent.getHasStartedWork()); assertFalse(child.getHasStartedWork());
    }
}

package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmCustomer;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.vo.PmOverviewVO;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 案件ヘルス一覧の集約（{@link PmOverviewService#buildProjectHealth}）。
 * トップレベルのみ・親はロールアップ進捗＋サブ件数・親かサブのいずれかが期限超過なら overdue。
 */
class PmOverviewProjectHealthTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 17);
    private static final Map<UUID, PmCustomer> NO_CUSTOMERS = Map.of();

    private static PmProject project(UUID parentId, String status, String end, int progress) {
        PmProject p = new PmProject();
        p.setId(UUID.randomUUID());
        p.setName("p-" + p.getId());
        p.setParentId(parentId);
        p.setStatus(status);
        p.setStart(LocalDate.of(2026, 10, 1));
        p.setEnd(LocalDate.parse(end));
        p.setProgress(progress);
        return p;
    }

    private static Map<UUID, PmProject> mapOf(PmProject... ps) {
        Map<UUID, PmProject> m = new LinkedHashMap<>();
        for (PmProject p : ps) {
            m.put(p.getId(), p);
        }
        return m;
    }

    @Test
    void subProjectsCollapseIntoParentRow() {
        PmProject parent = project(null, "active", "2026-12-31", 40);
        PmProject subA = project(parent.getId(), "active", "2026-12-10", 50);
        PmProject subB = project(parent.getId(), "done", "2026-11-01", 100);
        PmProject solo = project(null, "active", "2026-12-31", 10);
        Map<UUID, PmProject> map = mapOf(parent, subA, subB, solo);

        // 候補にサブだけが入っていても親の行になる（重複しない）
        List<PmOverviewVO.ProjectHealth> rows = PmOverviewService.buildProjectHealth(
            List.of(subA.getId(), subB.getId(), parent.getId(), solo.getId()),
            map, NO_CUSTOMERS, Map.of(subA.getId(), 2, parent.getId(), 1), TODAY);

        assertEquals(2, rows.size());
        PmOverviewVO.ProjectHealth p = rows.get(0);
        assertEquals(parent.getId().toString(), p.projectId());
        assertEquals(40, p.progress(), "親のキャッシュ進捗（ロールアップ値）をそのまま使う");
        assertEquals(3, p.delay(), "遅延数は親＋サブの合計");
        assertEquals(2, p.subCount());
        assertEquals(0, p.subOverdueCount(), "納品済みサブは期限超過にしない");
        assertFalse(p.overdue());

        PmOverviewVO.ProjectHealth s = rows.get(1);
        assertEquals(solo.getId().toString(), s.projectId());
        assertEquals(0, s.subCount());
    }

    @Test
    void parentIsOverdueWhenAnySubIsOverdue() {
        PmProject parent = project(null, "active", "2026-12-31", 60);
        PmProject late = project(parent.getId(), "active", "2026-11-10", 80);
        PmProject lateButComplete = project(parent.getId(), "active", "2026-11-10", 100);
        PmProject onTime = project(parent.getId(), "active", "2026-12-20", 20);
        Map<UUID, PmProject> map = mapOf(parent, late, lateButComplete, onTime);

        List<PmOverviewVO.ProjectHealth> rows = PmOverviewService.buildProjectHealth(
            List.of(late.getId()), map, NO_CUSTOMERS, Map.of(), TODAY);

        assertEquals(1, rows.size());
        PmOverviewVO.ProjectHealth p = rows.get(0);
        assertEquals(parent.getId().toString(), p.projectId());
        assertTrue(p.overdue());
        assertEquals(3, p.subCount());
        assertEquals(1, p.subOverdueCount(), "進捗 100% のサブは期限超過に数えない");
    }

    @Test
    void parentOwnOverdueStillCounts() {
        PmProject parent = project(null, "active", "2026-11-16", 90);
        PmProject sub = project(parent.getId(), "active", "2026-11-30", 90);
        List<PmOverviewVO.ProjectHealth> rows = PmOverviewService.buildProjectHealth(
            List.of(parent.getId()), mapOf(parent, sub), NO_CUSTOMERS, Map.of(), TODAY);

        assertTrue(rows.get(0).overdue());
        assertEquals(0, rows.get(0).subOverdueCount());
    }

    @Test
    void subWithInvisibleParentIsListedAsItsOwnRow() {
        // 親が可視範囲外（projectMap に無い）ならサブ自身を行にする
        PmProject sub = project(UUID.randomUUID(), "active", "2026-11-01", 30);
        List<PmOverviewVO.ProjectHealth> rows = PmOverviewService.buildProjectHealth(
            List.of(sub.getId()), mapOf(sub), NO_CUSTOMERS, Map.of(), TODAY);

        assertEquals(1, rows.size());
        assertEquals(sub.getId().toString(), rows.get(0).projectId());
        assertTrue(rows.get(0).overdue());
        assertEquals(0, rows.get(0).subCount());
    }
    @Test
    void onlyVisibleProjectsContributeAndMissingSeedsAreIgnored() {
        PmProject parent = project(null, "active", "2026-12-31", 70);
        // deleted / team-invisible projects are excluded from projectMap by overview().
        PmProject excludedSub = project(parent.getId(), "active", "2026-11-01", 10);
        List<PmOverviewVO.ProjectHealth> rows = PmOverviewService.buildProjectHealth(
            List.of(parent.getId(), excludedSub.getId()), mapOf(parent), NO_CUSTOMERS,
            Map.of(excludedSub.getId(), 9), TODAY);

        assertEquals(1, rows.size());
        assertEquals(0, rows.get(0).subCount());
        assertEquals(0, rows.get(0).delay());
        assertFalse(rows.get(0).overdue());
    }

    @Test
    void nullableFieldsAndOverdueBoundaries() {
        PmProject parent = project(null, "active", "2026-12-31", 70);
        parent.setProgress(null);
        parent.setStart(null);
        parent.setEnd(null);
        parent.setCustomerId(UUID.randomUUID()); // missing/deleted customer
        PmProject late = project(parent.getId(), "active", "2026-11-16", 0);
        late.setProgress(null);
        PmProject dueToday = project(parent.getId(), "active", "2026-11-17", 0);
        PmProject delivered = project(parent.getId(), "done", "2026-11-01", 0);
        List<PmOverviewVO.ProjectHealth> rows = PmOverviewService.buildProjectHealth(
            List.of(parent.getId()), mapOf(parent, late, dueToday, delivered),
            NO_CUSTOMERS, Map.of(), TODAY);

        assertEquals(1, rows.size());
        var row = rows.get(0);
        assertEquals(0, row.progress());
        assertNull(row.start());
        assertNull(row.end());
        assertNull(row.customerName());
        assertEquals(3, row.subCount());
        assertEquals(1, row.subOverdueCount());
        assertTrue(row.overdue());
    }

}

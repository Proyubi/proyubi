package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmBug;
import ai.proyubi.pm.domain.PmCustomer;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmBugMapper;
import ai.proyubi.pm.mapper.PmCustomerMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import ai.proyubi.pm.vo.PmSearchVO;
import com.mybatisflex.core.query.QueryCondition;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static ai.proyubi.pm.domain.table.PmBugTableDef.PM_BUG;
import static ai.proyubi.pm.domain.table.PmTaskTableDef.PM_TASK;
import static com.mybatisflex.core.query.QueryMethods.lower;

/**
 * PM 横断検索 Service（GET /app/pm/search）。
 * <p>
 * 前端のコマンドパレット（⌘K）専用。既存の一覧 API は必ず案件 / 顧客の配下でしか引けないため、
 * 「どの案件にあるか分からないタスク」を探す導線がこれまで無かった。
 * <p>
 * 絞り込みの順序は俯瞰（{@link PmOverviewService}）と同じ：
 * テナント → 論理削除除外 → キーワード（DB 側 LIKE）→ 多団隊可視域（Java 側）。
 * 可視域で落ちる分を見越して DB からは {@link #FETCH_CAP} 件まで拾い、
 * Java 側で関連度ソートしてから {@code limit} 件に切る。
 *
 */
@Service
public class PmSearchService {

    /** 種別ごとに DB から拾う上限。可視域フィルタで削られる前提の余裕分。 */
    private static final int FETCH_CAP = 300;

    /** limit の上限（前端が大きい値を投げても打ち切る）。 */
    private static final int MAX_LIMIT = 50;

    private final PmTaskMapper taskMapper;
    private final PmProjectMapper projectMapper;
    private final PmCustomerMapper customerMapper;
    private final PmBugMapper bugMapper;
    private final PmTeamScopeService teamScope;

    public PmSearchService(PmTaskMapper taskMapper, PmProjectMapper projectMapper,
                           PmCustomerMapper customerMapper, PmBugMapper bugMapper,
                           PmTeamScopeService teamScope) {
        this.taskMapper = taskMapper;
        this.projectMapper = projectMapper;
        this.customerMapper = customerMapper;
        this.bugMapper = bugMapper;
        this.teamScope = teamScope;
    }

    /**
     * 横断検索。
     *
     * @param tenantId 租户
     * @param keyword  検索語（空なら空結果）
     * @param types    返す種別。null / 空なら全種別。"task" / "project" / "bug"
     * @param limit    種別ごとの最大件数
     */
    public PmSearchVO search(UUID tenantId, String keyword, Set<String> types, int limit) {
        String kw = keyword == null ? "" : keyword.trim();
        if (kw.isEmpty()) {
            return PmSearchVO.empty();
        }
        int cap = Math.max(1, Math.min(limit, MAX_LIMIT));
        boolean wantTask = types == null || types.isEmpty() || types.contains("task");
        boolean wantProject = types == null || types.isEmpty() || types.contains("project");
        boolean wantBug = types == null || types.isEmpty() || types.contains("bug");

        // 案件 / 顧客は件数が小さいので全量をマップ化して名前解決に使う（俯瞰と同じ方針）
        Map<UUID, PmProject> projectMap = new HashMap<>();
        for (PmProject p : projectMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getDeletedAt).isNull())) {
            projectMap.put(p.getId(), p);
        }
        Map<UUID, PmCustomer> customerMap = new HashMap<>();
        for (PmCustomer c : customerMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmCustomer::getTenantId).eq(tenantId)
                .and(PmCustomer::getDeletedAt).isNull())) {
            customerMap.put(c.getId(), c);
        }

        // 多団隊可視域：null=無制限（owner / 機械コンテキスト）。team_id が null の歴史データは可視。
        List<UUID> visibleTeams = teamScope.visibleTeamIds();
        Set<UUID> allowTeams = visibleTeams == null ? null : new HashSet<>(visibleTeams);
        if (allowTeams != null) {
            projectMap.values().removeIf(p -> p.getTeamId() != null && !allowTeams.contains(p.getTeamId()));
            customerMap.values().removeIf(c -> c.getTeamId() != null && !allowTeams.contains(c.getTeamId()));
        }

        LocalDate today = LocalDate.now();
        return new PmSearchVO(
            wantTask ? searchTasks(tenantId, kw, cap, projectMap, customerMap, today) : List.of(),
            wantProject ? searchProjects(kw, cap, projectMap, customerMap) : List.of(),
            wantBug ? searchBugs(tenantId, kw, cap, projectMap, customerMap) : List.of()
        );
    }

    /** タスク：name のみでマッチ。案件が可視域外のものは落とす。 */
    private List<PmSearchVO.TaskHit> searchTasks(UUID tenantId, String kw, int cap,
                                                 Map<UUID, PmProject> projectMap,
                                                 Map<UUID, PmCustomer> customerMap,
                                                 LocalDate today) {
        List<PmTask> rows = taskMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTask::getTenantId).eq(tenantId)
                .and(PmTask::getDeletedAt).isNull()
                .and(lower(PM_TASK.NAME).like(kw.toLowerCase()))
                .limit(FETCH_CAP));

        List<PmSearchVO.TaskHit> hits = new ArrayList<>();
        for (PmTask t : rows) {
            PmProject project = t.getProjectId() != null ? projectMap.get(t.getProjectId()) : null;
            if (t.getProjectId() != null && project == null) {
                continue; // 可視域外 or 削除済み案件
            }
            PmCustomer customer = project != null && project.getCustomerId() != null
                ? customerMap.get(project.getCustomerId()) : null;
            int progress = t.getProgress() == null ? 0 : t.getProgress();
            hits.add(new PmSearchVO.TaskHit(
                str(t.getId()),
                t.getName(),
                t.getType(),
                str(t.getProjectId()),
                project == null ? null : project.getName(),
                customer == null ? null : str(customer.getId()),
                customer == null ? null : customer.getName(),
                t.getAssigneeIds() == null ? List.of() : t.getAssigneeIds(),
                str(t.getStart()),
                str(t.getEnd()),
                progress,
                overdueDays(t.getEnd(), progress, today)
            ));
        }
        hits.sort(Comparator
            .comparingInt((PmSearchVO.TaskHit h) -> relevance(h.name(), kw))
            .thenComparing(Comparator.comparingInt(PmSearchVO.TaskHit::overdueDays).reversed())
            .thenComparing(PmSearchVO.TaskHit::end, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(PmSearchVO.TaskHit::name, Comparator.nullsLast(Comparator.naturalOrder())));
        return trim(hits, cap);
    }

    /** 案件：案件名 or 顧客名でマッチ。可視域は projectMap の時点で効いている。 */
    private List<PmSearchVO.ProjectHit> searchProjects(String kw, int cap,
                                                       Map<UUID, PmProject> projectMap,
                                                       Map<UUID, PmCustomer> customerMap) {
        String needle = kw.toLowerCase();
        List<PmSearchVO.ProjectHit> hits = new ArrayList<>();
        for (PmProject p : projectMap.values()) {
            PmCustomer customer = p.getCustomerId() != null ? customerMap.get(p.getCustomerId()) : null;
            boolean byName = contains(p.getName(), needle);
            boolean byCustomer = customer != null
                && (contains(customer.getName(), needle) || contains(customer.getShortName(), needle));
            if (!byName && !byCustomer) {
                continue;
            }
            hits.add(new PmSearchVO.ProjectHit(
                str(p.getId()),
                p.getName(),
                customer == null ? null : str(customer.getId()),
                customer == null ? null : customer.getName(),
                p.getStatus(),
                str(p.getStart()),
                str(p.getEnd()),
                p.getProgress() == null ? 0 : p.getProgress(),
                p.getOpenTaskCount() == null ? 0 : p.getOpenTaskCount()
            ));
        }
        hits.sort(Comparator
            .comparingInt((PmSearchVO.ProjectHit h) -> relevance(h.name(), kw))
            .thenComparing(PmSearchVO.ProjectHit::name, Comparator.nullsLast(Comparator.naturalOrder())));
        return trim(hits, cap);
    }

    /** バグ票：title / bug_no でマッチ。顧客が可視域外のものは落とす。 */
    private List<PmSearchVO.BugHit> searchBugs(UUID tenantId, String kw, int cap,
                                               Map<UUID, PmProject> projectMap,
                                               Map<UUID, PmCustomer> customerMap) {
        String needle = kw.toLowerCase();
        // 画面は番号を「#67」と表示するので、「#67」「#067」で打たれたら bug_no（BUG-067）側に寄せる
        java.util.regex.Matcher no = java.util.regex.Pattern.compile("^#0*(\\d+)$").matcher(needle.trim());
        if (no.matches()) {
            needle = String.format("bug-%03d", Integer.parseInt(no.group(1)));
        }
        // title / bug_no のどちらかにヒット。QueryCondition を先に組むのは
        // and(LambdaGetter) と and(Consumer) のオーバーロードが曖昧になるのを避けるため。
        QueryCondition keywordCond = lower(PM_BUG.TITLE).like(needle)
            .or(lower(PM_BUG.BUG_NO).like(needle));
        List<PmBug> rows = bugMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmBug::getTenantId).eq(tenantId)
                .and(PmBug::getDeletedAt).isNull()
                .and(keywordCond)
                .orderBy(PmBug::getSeq, false)
                .limit(FETCH_CAP));

        List<PmSearchVO.BugHit> hits = new ArrayList<>();
        for (PmBug b : rows) {
            PmCustomer customer = b.getCustomerId() != null ? customerMap.get(b.getCustomerId()) : null;
            if (b.getCustomerId() != null && customer == null) {
                continue; // 可視域外 or 削除済み顧客
            }
            PmProject project = b.getProjectId() != null ? projectMap.get(b.getProjectId()) : null;
            hits.add(new PmSearchVO.BugHit(
                str(b.getId()),
                b.getBugNo(),
                b.getTitle(),
                b.getStatus(),
                b.getSeverity(),
                customer == null ? null : str(customer.getId()),
                customer == null ? null : customer.getName(),
                project == null ? null : str(project.getId()),
                project == null ? null : project.getName(),
                b.getAssigneeName(),
                str(b.getReportedOn())
            ));
        }
        return trim(hits, cap);
    }

    /** 0=完全一致, 1=前方一致, 2=部分一致。パレット上位に「探していたもの」が来るように。 */
    private static int relevance(String name, String kw) {
        if (name == null) {
            return 3;
        }
        String n = name.toLowerCase();
        String k = kw.toLowerCase();
        if (n.equals(k)) {
            return 0;
        }
        return n.startsWith(k) ? 1 : 2;
    }

    private static int overdueDays(LocalDate end, int progress, LocalDate today) {
        if (end == null || progress >= 100 || !end.isBefore(today)) {
            return 0;
        }
        return (int) ChronoUnit.DAYS.between(end, today);
    }

    private static boolean contains(String haystack, String lowerNeedle) {
        return haystack != null && haystack.toLowerCase().contains(lowerNeedle);
    }

    private static <T> List<T> trim(List<T> list, int cap) {
        return list.size() <= cap ? list : new ArrayList<>(list.subList(0, cap));
    }

    private static String str(Object v) {
        return v == null ? null : v.toString();
    }
}

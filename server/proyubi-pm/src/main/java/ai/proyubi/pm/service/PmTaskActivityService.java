package ai.proyubi.pm.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.domain.PmTaskActivity;
import ai.proyubi.pm.mapper.PmMemberMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskActivityMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import ai.proyubi.pm.mapper.PmTenantUserMapper;
import ai.proyubi.pm.vo.PmTaskActivityVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * タスク操作履歴Service（PM）。
 * <p>
 * 「誰が・いつ・タスクのどのフィールドを追加/変更/削除したか」だけを追記する。
 * コメント本文・バグ詳細・ケース結果は各タブが一次情報を持つため記録しない（二重記録の回避）。
 * <p>
 * 設計上の約束：
 * <ul>
 *   <li>1回の保存＝1行。変わったフィールドは {@code changes} 配列に畳み込む</li>
 *   <li>from/to は表示用スナップショット。担当者や親タスクが後で消えても履歴が読める</li>
 *   <li>並び順（order）と折り畳み（collapsed）は UI 操作なので記録しない（ドラッグのたびに履歴が汚れる）</li>
 *   <li>サマリーの期間・進捗は rollup による非永続の計算値なので、そもそも差分に現れない</li>
 *   <li>記録は呼び出し元と同一トランザクション（＝保存が成功した操作だけが履歴に残る）</li>
 * </ul>
 * <p>
 * {@link PmTaskService} から呼ばれるため、こちらは Service ではなく Mapper だけに依存する
 * （相互依存＝循環参照を作らないため。可視性チェックは呼び出し側の責務）。
 *
 */
@Service
public class PmTaskActivityService {

    private static final Logger log = LoggerFactory.getLogger(PmTaskActivityService.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    /** 説明（リッチテキスト）の履歴保存上限。全文ではなく読める長さだけ残す */
    private static final int DESCRIPTION_LIMIT = 500;
    /** 一覧の既定件数上限 */
    private static final int DEFAULT_LIMIT = 100;

    public static final String ACTION_CREATED = "created";
    public static final String ACTION_UPDATED = "updated";
    public static final String ACTION_CHILD_ADDED = "child_added";
    public static final String ACTION_CHILD_REMOVED = "child_removed";
    public static final String ACTION_DEP_ADDED = "dep_added";
    public static final String ACTION_DEP_REMOVED = "dep_removed";

    private final PmTaskActivityMapper activityMapper;
    private final PmTaskMapper taskMapper;
    private final PmProjectMapper projectMapper;
    private final PmMemberMapper memberMapper;
    private final PmTenantUserMapper tenantUserMapper;
    private final PmMemberResolver memberResolver;

    public PmTaskActivityService(PmTaskActivityMapper activityMapper, PmTaskMapper taskMapper,
                                 PmProjectMapper projectMapper, PmMemberMapper memberMapper,
                                 PmTenantUserMapper tenantUserMapper, PmMemberResolver memberResolver) {
        this.activityMapper = activityMapper;
        this.taskMapper = taskMapper;
        this.projectMapper = projectMapper;
        this.memberMapper = memberMapper;
        this.tenantUserMapper = tenantUserMapper;
        this.memberResolver = memberResolver;
    }

    // ------------------------------------------------------------------
    // 読み取り
    // ------------------------------------------------------------------

    /**
     * 某タスクの操作履歴（新しい順）。呼び出し側で先にタスクの可視性を検証すること。
     */
    public List<PmTaskActivityVO> list(UUID tenantId, UUID taskId, Integer limit) {
        int max = limit != null && limit > 0 ? Math.min(limit, 500) : DEFAULT_LIMIT;
        List<PmTaskActivity> rows = activityMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmTaskActivity::getTenantId).eq(tenantId)
                .and(PmTaskActivity::getTaskId).eq(taskId)
                .orderBy(PmTaskActivity::getCreatedAt, false)
                .limit(max)
        );
        List<PmTaskActivityVO> out = new ArrayList<>(rows.size());
        for (PmTaskActivity r : rows) {
            out.add(new PmTaskActivityVO(
                r.getId(), r.getTaskId(), r.getActorMemberId(), r.getActorName(),
                r.getAction(), r.getSource(), r.getCreatedAt(), parseChanges(r.getChanges())));
        }
        return out;
    }

    private List<PmTaskActivityVO.Change> parseChanges(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return JSON.readValue(json, new TypeReference<List<PmTaskActivityVO.Change>>() {
            });
        } catch (Exception e) {
            log.warn("操作履歴の changes をパースできませんでした: {}", e.getMessage());
            return List.of();
        }
    }

    // ------------------------------------------------------------------
    // 書き込み
    // ------------------------------------------------------------------

    /** 作成：主要な初期値だけをまとめて1行に残す（フィールドごとの差分にはしない）。 */
    public void recordCreated(UUID tenantId, PmTask task) {
        List<PmTaskActivityVO.Change> changes = new ArrayList<>();
        changes.add(PmTaskActivityVO.Change.of("type", null, task.getType()));
        String range = fmtRange(task.getStart(), task.getEnd());
        if (!range.isEmpty()) {
            changes.add(PmTaskActivityVO.Change.of("planRange", null, range));
        }
        List<String> assignees = isEmpty(task.getAssigneeIds())
            ? List.of() : memberNames(loadMemberNames(tenantId), task.getAssigneeIds());
        if (!assignees.isEmpty()) {
            changes.add(PmTaskActivityVO.Change.ofSet("assignees", assignees, null));
        }
        write(tenantId, task.getId(), task.getProjectId(), ACTION_CREATED, changes);
    }

    /**
     * 更新：{@code before}（更新前スナップショット）と現在値を突き合わせて差分を作る。
     * 差分ゼロなら記録しない（保存ボタンを押しただけの空更新で履歴を汚さない）。
     */
    public void recordUpdated(UUID tenantId, PmTask before, PmTask after) {
        List<PmTaskActivityVO.Change> changes = diff(tenantId, before, after);
        if (changes.isEmpty()) {
            return;
        }
        write(tenantId, after.getId(), after.getProjectId(), ACTION_UPDATED, changes);
    }

    /** サブタスクの追加／削除を「親タスク側」の履歴に残す。 */
    public void recordChild(UUID tenantId, UUID parentId, UUID projectId, String childName, boolean added) {
        if (parentId == null) {
            return;
        }
        write(tenantId, parentId, projectId,
            added ? ACTION_CHILD_ADDED : ACTION_CHILD_REMOVED,
            List.of(added
                ? PmTaskActivityVO.Change.ofSet("subtask", List.of(nz(childName)), null)
                : PmTaskActivityVO.Change.ofSet("subtask", null, List.of(nz(childName)))));
    }

    /**
     * 依存（FS）の追加／削除を両側のタスクに残す。
     * 後続タスク側には「先行タスク」、先行タスク側には「後続タスク」として記録し、
     * どちらのドロワーを開いても経緯が読めるようにする。
     */
    public void recordDependency(UUID tenantId, UUID projectId, PmTask predecessor, PmTask successor, boolean added) {
        String action = added ? ACTION_DEP_ADDED : ACTION_DEP_REMOVED;
        write(tenantId, successor.getId(), projectId, action,
            List.of(added
                ? PmTaskActivityVO.Change.ofSet("predecessor", List.of(nz(predecessor.getName())), null)
                : PmTaskActivityVO.Change.ofSet("predecessor", null, List.of(nz(predecessor.getName())))));
        write(tenantId, predecessor.getId(), projectId, action,
            List.of(added
                ? PmTaskActivityVO.Change.ofSet("successor", List.of(nz(successor.getName())), null)
                : PmTaskActivityVO.Change.ofSet("successor", null, List.of(nz(successor.getName())))));
    }

    /**
     * 実書き込み。呼び出し元（{@link PmTaskService} など）のトランザクションにそのまま乗る。
     * <p>
     * 例外は握り潰さない。同一トランザクション内で INSERT が失敗した場合、PostgreSQL は
     * そのトランザクションを異常終了状態にするため、ここで握り潰すと後続の SQL（進捗の再計算など）が
     * 「current transaction is aborted」で連鎖失敗し、原因が見えないまま保存が壊れる。
     * 履歴が書けない状況（テーブル未作成＝マイグレーション未適用）は静かに劣化させず、
     * 保存ごと失敗させて気付けるようにする。
     */
    private void write(UUID tenantId, UUID taskId, UUID projectId, String action,
                       List<PmTaskActivityVO.Change> changes) {
        UUID userId = TenantContext.getUserId();
        PmMember member = memberResolver.findMember(tenantId, userId);

        PmTaskActivity row = new PmTaskActivity();
        row.setId(UUID.randomUUID());
        row.setTenantId(tenantId);
        row.setTaskId(taskId);
        row.setProjectId(projectId);
        row.setActorUserId(userId);
        row.setActorMemberId(member != null ? member.getId() : null);
        row.setActorName(resolveActorName(tenantId, userId, member));
        row.setAction(action);
        row.setChanges(writeJson(changes));
        row.setSource(currentSource());
        row.setCreatedAt(LocalDateTime.now());
        activityMapper.insert(row);
    }

    /** 差分配列 → jsonb 文字列。ここで失敗するのは実装バグなので握り潰さない。 */
    private static String writeJson(List<PmTaskActivityVO.Change> changes) {
        try {
            return JSON.writeValueAsString(changes);
        } catch (Exception e) {
            throw new IllegalStateException("操作履歴の差分をJSON化できませんでした", e);
        }
    }

    /** 操作者表示名：PM メンバー名 → 租户ユーザ表示名 → 内部呼び出しなら「MCP」→「—」。 */
    private String resolveActorName(UUID tenantId, UUID userId, PmMember member) {
        if (member != null && member.getName() != null && !member.getName().isBlank()) {
            return member.getName();
        }
        if (userId != null) {
            String name = tenantUserMapper.findDisplayName(tenantId, userId);
            if (name != null && !name.isBlank()) {
                return name;
            }
        }
        return "mcp".equals(currentSource()) ? "MCP" : "—";
    }

    /** 操作元：{@code /internal/**}（API キー経由＝MCP・自動連携）なら mcp、それ以外は web。 */
    private String currentSource() {
        RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
        if (attrs instanceof ServletRequestAttributes sra) {
            String uri = sra.getRequest().getRequestURI();
            if (uri != null && uri.startsWith("/internal/")) {
                return "mcp";
            }
        }
        return "web";
    }

    // ------------------------------------------------------------------
    // 差分
    // ------------------------------------------------------------------

    /**
     * 更新前後のタスクを突き合わせて差分配列を作る。
     * 期間（開始/終了）と工期（日数/時間）はそれぞれ1行に束ねる（画面の入力欄と一致させ、
     * 「開始が変わった」「終了が変わった」の2行に割れないようにする）。
     */
    private List<PmTaskActivityVO.Change> diff(UUID tenantId, PmTask a, PmTask b) {
        List<PmTaskActivityVO.Change> out = new ArrayList<>();

        addIfChanged(out, "name", a.getName(), b.getName());
        addIfChanged(out, "type", a.getType(), b.getType());
        addIfChanged(out, "status", a.getStatus(), b.getStatus());
        addIfChanged(out, "progress", str(a.getProgress()), str(b.getProgress()));
        addIfChanged(out, "planRange", fmtRange(a.getStart(), a.getEnd()), fmtRange(b.getStart(), b.getEnd()));
        addIfChanged(out, "actualRange",
            fmtRange(a.getActualStart(), a.getActualEnd()), fmtRange(b.getActualStart(), b.getActualEnd()));
        addIfChanged(out, "plannedEffort",
            fmtEffort(a.getPlannedEffortDays(), a.getPlannedEffortHours()),
            fmtEffort(b.getPlannedEffortDays(), b.getPlannedEffortHours()));
        addIfChanged(out, "actualEffort",
            fmtEffort(a.getActualEffortDays(), a.getActualEffortHours()),
            fmtEffort(b.getActualEffortDays(), b.getActualEffortHours()));

        // 集合フィールド：矢印ではなく ＋追加 / －削除 で見せる
        // 担当者名の解決は前後で同じ名簿を使えばよいので、1回だけ引いて使い回す
        // （両方空＝指派なしのタスクでは名簿を引かない）
        Map<String, String> nameById = isEmpty(a.getAssigneeIds()) && isEmpty(b.getAssigneeIds())
            ? Map.of() : loadMemberNames(tenantId);
        addSetIfChanged(out, "assignees",
            memberNames(nameById, a.getAssigneeIds()), memberNames(nameById, b.getAssigneeIds()));
        addSetIfChanged(out, "levels", nzList(a.getLevels()), nzList(b.getLevels()));

        addIfChanged(out, "description", plainText(a.getDescription()), plainText(b.getDescription()));
        addIfChanged(out, "parent", taskName(a.getParentId()), taskName(b.getParentId()));
        addIfChanged(out, "project", projectName(a.getProjectId()), projectName(b.getProjectId()));
        addIfChanged(out, "roadmapVisible", str(a.getRoadmapVisible()), str(b.getRoadmapVisible()));
        addIfChanged(out, "roadmapLane", a.getRoadmapLane(), b.getRoadmapLane());
        addIfChanged(out, "ownerParty", a.getOwnerParty(), b.getOwnerParty());
        addIfChanged(out, "milestoneColor", a.getMilestoneColor(), b.getMilestoneColor());
        // collapsed / order は UI 操作のため意図的に記録しない
        return out;
    }

    private void addIfChanged(List<PmTaskActivityVO.Change> out, String field, String from, String to) {
        String f = nz(from);
        String t = nz(to);
        if (!Objects.equals(f, t)) {
            out.add(PmTaskActivityVO.Change.of(field, f, t));
        }
    }

    /** 集合の差分：順序の入れ替えは変更とみなさない（追加・削除だけを見る）。 */
    private void addSetIfChanged(List<PmTaskActivityVO.Change> out, String field,
                                 List<String> from, List<String> to) {
        Set<String> before = new LinkedHashSet<>(from);
        Set<String> after = new LinkedHashSet<>(to);
        List<String> added = new ArrayList<>();
        List<String> removed = new ArrayList<>();
        for (String s : after) {
            if (!before.contains(s)) {
                added.add(s);
            }
        }
        for (String s : before) {
            if (!after.contains(s)) {
                removed.add(s);
            }
        }
        if (!added.isEmpty() || !removed.isEmpty()) {
            out.add(PmTaskActivityVO.Change.ofSet(field,
                added.isEmpty() ? null : added, removed.isEmpty() ? null : removed));
        }
    }

    // ------------------------------------------------------------------
    // 値の整形（表示名スナップショット）
    // ------------------------------------------------------------------

    /** 租户のメンバー名簿（id → 表示名）。 */
    private Map<String, String> loadMemberNames(UUID tenantId) {
        List<PmMember> members = memberMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmMember::getTenantId).eq(tenantId)
                .and(PmMember::getDeletedAt).isNull());
        Map<String, String> byId = new LinkedHashMap<>();
        for (PmMember m : members) {
            byId.put(m.getId().toString(), m.getName());
        }
        return byId;
    }

    /** 担当者 id 配列 → 表示名配列（解決できない id は素の値のまま残す）。 */
    private List<String> memberNames(Map<String, String> byId, List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        List<String> out = new ArrayList<>(ids.size());
        for (String id : ids) {
            if (id == null || id.isBlank()) {
                continue;
            }
            String name = byId.get(id);
            out.add(name != null && !name.isBlank() ? name : id);
        }
        return out;
    }

    private String taskName(UUID taskId) {
        if (taskId == null) {
            return "";
        }
        PmTask t = taskMapper.selectOneById(taskId);
        return t != null ? nz(t.getName()) : "";
    }

    private String projectName(UUID projectId) {
        if (projectId == null) {
            return "";
        }
        PmProject p = projectMapper.selectOneById(projectId);
        return p != null ? nz(p.getName()) : "";
    }

    /** 期間 → {@code "2026-08-17~2026-09-04"}（片側だけなら空側は空文字、両側 null なら空文字）。 */
    private static String fmtRange(LocalDate start, LocalDate end) {
        if (start == null && end == null) {
            return "";
        }
        return (start != null ? start.toString() : "") + "~" + (end != null ? end.toString() : "");
    }

    /** 工期 → {@code "13d 4h"} / {@code "4h"} / 空文字（＝期間から自動）。 */
    private static String fmtEffort(Integer days, Double hours) {
        StringBuilder sb = new StringBuilder();
        if (days != null && days > 0) {
            sb.append(days).append('d');
        }
        if (hours != null && hours > 0) {
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(trimNumber(hours)).append('h');
        }
        return sb.toString();
    }

    /** 4.0 → "4"、4.25 → "4.25"（末尾の 0 を落として読みやすく）。 */
    private static String trimNumber(double v) {
        if (v == Math.rint(v)) {
            return String.valueOf((long) v);
        }
        return String.valueOf(v);
    }

    /**
     * リッチテキスト（HTML）→ 履歴用のプレーンテキスト。
     * 画像やタグは落とし、空白を畳んで {@value #DESCRIPTION_LIMIT} 文字で打ち切る
     * （履歴に本文全体を積むと行が肥大するため。全文は説明欄そのものが持つ）。
     */
    private static String plainText(String html) {
        if (html == null || html.isBlank()) {
            return "";
        }
        String text = html
            .replaceAll("(?is)<(script|style)[^>]*>.*?</\\1>", " ")
            .replaceAll("(?i)<br\\s*/?>", "\n")
            .replaceAll("(?i)</(p|div|li|h[1-6])>", "\n")
            .replaceAll("(?i)<img[^>]*>", "[画像]")
            .replaceAll("<[^>]+>", "")
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replaceAll("[ \\t]+", " ")
            .replaceAll("\\n{3,}", "\n\n")
            .trim();
        return text.length() > DESCRIPTION_LIMIT ? text.substring(0, DESCRIPTION_LIMIT) + "…" : text;
    }

    private static String str(Object v) {
        return v == null ? "" : String.valueOf(v);
    }

    private static String nz(String v) {
        return v == null ? "" : v;
    }

    private static boolean isEmpty(List<String> v) {
        return v == null || v.isEmpty();
    }

    private static List<String> nzList(List<String> v) {
        return v == null ? List.of() : v;
    }

    /**
     * 更新前スナップショット。{@link PmTaskService#update} は読み込んだエンティティを
     * その場で書き換えるため、差分計算用に更新前の値をここで写し取っておく。
     */
    public static PmTask snapshot(PmTask t) {
        PmTask s = new PmTask();
        s.setId(t.getId());
        s.setTenantId(t.getTenantId());
        s.setProjectId(t.getProjectId());
        s.setParentId(t.getParentId());
        s.setName(t.getName());
        s.setStart(t.getStart());
        s.setEnd(t.getEnd());
        s.setActualStart(t.getActualStart());
        s.setActualEnd(t.getActualEnd());
        s.setPlannedEffortHours(t.getPlannedEffortHours());
        s.setActualEffortHours(t.getActualEffortHours());
        s.setPlannedEffortDays(t.getPlannedEffortDays());
        s.setActualEffortDays(t.getActualEffortDays());
        s.setProgress(t.getProgress());
        s.setAssigneeIds(t.getAssigneeIds() != null ? List.copyOf(t.getAssigneeIds()) : null);
        s.setLevels(t.getLevels() != null ? List.copyOf(t.getLevels()) : null);
        s.setDescription(t.getDescription());
        s.setType(t.getType());
        s.setCollapsed(t.getCollapsed());
        s.setRoadmapVisible(t.getRoadmapVisible());
        s.setRoadmapLane(t.getRoadmapLane());
        s.setOwnerParty(t.getOwnerParty());
        s.setMilestoneColor(t.getMilestoneColor());
        s.setStatus(t.getStatus());
        s.setOrder(t.getOrder());
        return s;
    }
}

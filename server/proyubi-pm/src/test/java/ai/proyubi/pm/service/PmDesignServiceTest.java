package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmDesign;
import ai.proyubi.pm.domain.PmDesignComment;
import ai.proyubi.pm.domain.PmDesignFrame;
import ai.proyubi.pm.domain.PmDesignRevision;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmDesignCommentMapper;
import ai.proyubi.pm.mapper.PmDesignFrameMapper;
import ai.proyubi.pm.mapper.PmDesignMapper;
import ai.proyubi.pm.mapper.PmDesignRevisionMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import ai.proyubi.pm.mapper.PmTenantUserMapper;
import ai.proyubi.pm.service.PmDesignService.CreateInput;
import ai.proyubi.pm.service.PmDesignService.SaveInput;
import ai.proyubi.pm.service.PmDesignService.SourceInput;
import ai.proyubi.pm.vo.PmDesignCommentVO;
import ai.proyubi.pm.vo.PmDesignVO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;

import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PmDesignService の行為テスト（requirements A2 / A3 / A4 / A5 / A7）。
 * DB は JDK Proxy の内存 Mapper で代替。advanceRevision は SQL と同じ WHERE 条件
 * （tenant_id / id / current_revision / deleted_at）で 0/1 を返すので、サービスが
 * 「Java 側の比較」ではなく DB の更新件数で 409 を判定していることを検証できる。
 * 実 SQL の CAS は work/design-studio/logs の PostgreSQL 検証を参照。
 */
class PmDesignServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID OTHER_TENANT = UUID.randomUUID();
    private static final UUID USER_A = UUID.randomUUID();
    private static final UUID USER_B = UUID.randomUUID();

    private final Map<UUID, PmProject> projects = new HashMap<>();
    private final Map<UUID, PmTask> tasks = new HashMap<>();
    /** 呼び出し者から見えない（別チーム）案件 */
    private final Set<UUID> invisibleProjects = new HashSet<>();

    private final Map<UUID, PmDesign> designs = new HashMap<>();
    private final List<PmDesignRevision> revisions = new ArrayList<>();
    private final Map<UUID, PmDesignComment> comments = new HashMap<>();
    /** 画框：key = designId + "/" + nodeId */
    private final Map<String, PmDesignFrame> frames = new HashMap<>();
    /** advanceRevision が呼ばれる直前に割り込む「別クライアントの保存」 */
    private Runnable beforeCas;
    private Runnable beforeDesignMutation;
    private Runnable beforeCommentMutation;

    private void interceptDesignMutation() {
        Runnable hook = beforeDesignMutation;
        beforeDesignMutation = null;
        if (hook != null) hook.run();
    }

    private void interceptCommentMutation() {
        Runnable hook = beforeCommentMutation;
        beforeCommentMutation = null;
        if (hook != null) hook.run();
    }

    /** 現在有効な PM 利用権を持つ租户ユーザー（DB 查询の結果を模擬）。 */
    private final Set<UUID> activePmUsers = new HashSet<>();
    private PmDesignService service;
    private UUID projectA;
    private UUID projectB;
    private UUID taskA;
    private UUID taskB;

    @BeforeEach
    void setUp() {
        activePmUsers.add(USER_A);
        activePmUsers.add(USER_B);
        projectA = project(TENANT);
        projectB = project(TENANT);
        taskA = task(projectA);
        taskB = task(projectB);

        PmProjectService projectService = new PmProjectService(null, null, null, null, null, null, null, null, null) {
            @Override
            public PmProject getByIdAndTenant(UUID id, UUID tenantId) {
                PmProject p = projects.get(id);
                if (p == null || !p.getTenantId().equals(tenantId) || invisibleProjects.contains(id)) {
                    throw BizException.of(404, "项目不存在");
                }
                return p;
            }
        };
        PmTaskService taskService = new PmTaskService(null, null, null, null, null, null, null, null, null, null) {
            @Override
            public PmTask getVisibleTask(UUID id, UUID tenantId) {
                PmTask t = tasks.get(id);
                if (t == null || !t.getTenantId().equals(tenantId) || invisibleProjects.contains(t.getProjectId())) {
                    throw BizException.of(404, "任务不存在");
                }
                return t;
            }
        };
        PmMemberResolver memberResolver = new PmMemberResolver(null) {
            @Override
            public PmMember findMember(UUID tenantId, UUID userId) {
                return null;
            }
        };
        service = new PmDesignService(designMapper(), revisionMapper(), commentMapper(),
            fake(PmProjectMapper.class, (m, a) -> {
                if (m.equals("selectListByIds")) {
                    return ((Collection<?>) a[0]).stream().map(projects::get).filter(Objects::nonNull).toList();
                }
                throw new UnsupportedOperationException(m);
            }),
            fake(PmTaskMapper.class, (m, a) -> {
                if (m.equals("selectListByIds")) {
                    return ((Collection<?>) a[0]).stream().map(tasks::get).filter(Objects::nonNull).toList();
                }
                throw new UnsupportedOperationException(m);
            }),
            projectService, taskService, memberResolver,
            fake(PmTenantUserMapper.class, (m, a) -> {
                if (m.equals("findDisplayName")) {
                    return a[1].equals(USER_A) ? "Alice" : "Bob";
                }
                if (m.equals("listPmMembersByTenant")) {
                    if (!TENANT.equals(a[0])) return List.of();
                    return activePmUsers.stream().map(id -> {
                        ai.proyubi.pm.vo.PmTenantUserVO u = new ai.proyubi.pm.vo.PmTenantUserVO();
                        u.setId(id);
                        u.setEnabled(true);
                        return u;
                    }).toList();
                }
                throw new UnsupportedOperationException(m);
            }),
            new PmDesignFrameSyncer(frameMapper()),
            10 * 1024 * 1024, 5000, 5 * 1024 * 1024, 32 * 1024 * 1024);
    }

    // ------------------------------------------------------------------ 作成・タスク紐付け（A2）

    @Test
    void unknownActorCannotWriteEvenWhenProjectHasNoTeam() {
        assertCode(403, () -> service.create(TENANT, UUID.randomUUID(), excalidraw(projectA, null, null), "mcp"));
    }

    @Test
    void inactiveOrRevokedPmActorCannotWrite() {
        activePmUsers.remove(USER_B);
        assertCode(403, () -> service.create(TENANT, USER_B, excalidraw(projectA, null, null), "mcp"));
    }

    @Test
    void internalListRejectsUnknownActorBeforeReadingUnscopedProject() {
        var controller = new ai.proyubi.pm.controller.PmDesignInternalController(service, null, null);
        ai.proyubi.common.core.context.TenantContext.setTenantId(TENANT);
        ai.proyubi.common.core.context.TenantContext.setUserId(UUID.randomUUID());
        try {
            assertCode(403, () -> controller.list(projectA, null));
        } finally {
            ai.proyubi.common.core.context.TenantContext.clear();
        }
    }

    @Test
    void createExcalidrawInVisibleProjectStartsAtRevisionOne() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, taskA, scene("a")), "web");
        assertEquals(1, vo.currentRevision());
        assertEquals("excalidraw", vo.format());
        assertEquals(taskA, vo.taskId());
        assertEquals("Alice", vo.createdByName());
        assertEquals(1, revisionsOf(vo.id()).size());
        assertTrue(service.get(vo.id(), TENANT, null).content().contains("\"id\":\"a\""));
    }

    @Test
    void createWithoutContentUsesEmptyScene() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, null), "web");
        assertTrue(service.get(vo.id(), TENANT, null).content().contains("\"elements\":[]"));
    }

    @Test
    void taskOfAnotherProjectIsRejected() {
        assertCode(400, () -> service.create(TENANT, USER_A, excalidraw(projectA, taskB, null), "web"));
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, null), "web");
        assertCode(400, () -> service.updateMeta(vo.id(), TENANT, USER_A, null, taskB, false));
    }

    @Test
    void linkAndUnlinkTaskOfSameProject() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, null), "web");
        assertEquals(taskA, service.updateMeta(vo.id(), TENANT, USER_A, "新タイトル", taskA, false).taskId());
        assertEquals(1, service.list(TENANT, null, taskA).size());
        assertEquals(1, service.list(TENANT, projectA, null).size());
        assertEquals(0, service.list(TENANT, projectB, null).size());
        PmDesignVO cleared = service.updateMeta(vo.id(), TENANT, USER_A, null, null, true);
        assertNull(cleared.taskId());
        assertEquals("新タイトル", cleared.title());
    }

    // ------------------------------------------------------------------ 権限（A4）

    @Test
    void invisibleOrCrossTenantProjectIsNotFound() {
        invisibleProjects.add(projectB);
        assertCode(404, () -> service.create(TENANT, USER_A, excalidraw(projectB, null, null), "web"));
        assertCode(404, () -> service.list(TENANT, projectB, null));

        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, null), "web");
        assertCode(404, () -> service.get(vo.id(), OTHER_TENANT, null));
        assertCode(403, () -> service.save(vo.id(), OTHER_TENANT, USER_A, save(1, scene("x")), "web"));
        invisibleProjects.add(projectA);
        assertCode(404, () -> service.get(vo.id(), TENANT, null));
        assertCode(404, () -> service.listComments(vo.id(), TENANT, USER_A, null));
    }

    @Test
    void writesWithoutUserAreRejected() {
        assertCode(401, () -> service.create(TENANT, null, excalidraw(projectA, null, null), "mcp"));
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, null), "web");
        assertCode(401, () -> service.save(vo.id(), TENANT, null, save(1, scene("x")), "mcp"));
        assertCode(401, () -> service.addComment(vo.id(), TENANT, null, 1, null, "hi", "mcp"));
        assertCode(401, () -> service.updateMeta(vo.id(), TENANT, null, "t", null, false));
        assertCode(401, () -> service.delete(vo.id(), TENANT, null));
    }

    @Test
    void invalidFormatOrContentIsBadRequest() {
        CreateInput bad = new CreateInput(projectA, null, "t", "html", "<script>", null, null, null, null);
        assertCode(400, () -> service.create(TENANT, USER_A, bad, "web"));
        assertCode(400, () -> service.create(TENANT, USER_A, excalidraw(projectA, null, "{oops"), "web"));
        assertCode(400, () -> service.create(TENANT, USER_A, excalidraw(null, null, null), "web"));
    }

    // ------------------------------------------------------------------ 修訂・CAS（A3）

    @Test
    void saveAdvancesRevisionAndKeepsHistoryImmutable() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("v1")), "web");
        String v1 = service.get(vo.id(), TENANT, 1).content();
        PmDesignVO saved = service.save(vo.id(), TENANT, USER_B, save(1, scene("v2")), "mcp");
        assertEquals(2, saved.currentRevision());
        assertEquals("Bob", saved.updatedByName());
        assertEquals(v1, service.get(vo.id(), TENANT, 1).content(), "旧修訂は書き換えない");
        assertTrue(service.get(vo.id(), TENANT, null).content().contains("\"id\":\"v2\""));
        assertEquals("mcp", revisionsOf(vo.id()).get(1).getVia());
        assertEquals(2, service.get(vo.id(), TENANT, null).revisions().size());
    }

    @Test
    void staleExpectedRevisionIsConflictAndWritesNothing() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("v1")), "web");
        // クライアント A・B が同じ rev1 を読み、A が先に保存
        service.save(vo.id(), TENANT, USER_A, save(1, scene("fromA")), "web");
        assertCode(409, () -> service.save(vo.id(), TENANT, USER_B, save(1, scene("fromB")), "web"));
        assertEquals(2, revisionsOf(vo.id()).size());
        assertTrue(service.get(vo.id(), TENANT, null).content().contains("fromA"));
    }

    @Test
    void conflictIsDecidedByDatabaseUpdateCountNotJavaRead() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("v1")), "web");
        // サービスが行を読んだ後・CAS の直前に別の保存がコミットされた状況
        beforeCas = () -> designs.get(vo.id()).setCurrentRevision(2);
        assertCode(409, () -> service.save(vo.id(), TENANT, USER_B, save(1, scene("late")), "web"));
        assertEquals(1, revisionsOf(vo.id()).size(), "CAS 失敗時は修訂を挿入しない");
    }

    @Test
    void missingExpectedRevisionIsBadRequest() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, null), "web");
        assertCode(400, () -> service.save(vo.id(), TENANT, USER_A, save(null, scene("x")), "web"));
    }

    @Test
    void identicalContentIsIdempotentButStillChecksRevision() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("same")), "web");
        PmDesignVO again = service.save(vo.id(), TENANT, USER_A, save(1, scene("same")), "web");
        assertEquals(1, again.currentRevision());
        assertEquals(1, revisionsOf(vo.id()).size());
        service.save(vo.id(), TENANT, USER_A, save(1, scene("other")), "web");
        assertCode(409, () -> service.save(vo.id(), TENANT, USER_A, save(1, scene("other")), "web"));
    }

    @Test
    void deletedDesignCannotBeSavedOrRead() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, null), "web");
        service.delete(vo.id(), TENANT, USER_A);
        assertCode(404, () -> service.get(vo.id(), TENANT, null));
        assertCode(404, () -> service.save(vo.id(), TENANT, USER_A, save(1, scene("x")), "web"));
        assertEquals(0, service.list(TENANT, projectA, null).size());
    }

    // ------------------------------------------------------------------ .pen 原文・Git 由来（A5 / A9）

    @Test
    void penRoundTripsOriginalBytes() {
        byte[] raw = "{\"version\":\"2.6\",\"children\":[{\"type\":\"x-unknown\"}]}\n".getBytes(StandardCharsets.UTF_8);
        String b64 = Base64.getEncoder().encodeToString(raw);
        CreateInput in = new CreateInput(projectA, null, null, "pen", null, b64, "home.pen", null,
            new SourceInput("git@example:team/app.git", "main", "design/home.pen", "abc123"));
        PmDesignVO vo = service.create(TENANT, USER_A, in, "web");
        PmDesignVO got = service.get(vo.id(), TENANT, null);
        assertEquals("home.pen", got.title(), "タイトル省略時はファイル名");
        assertEquals("base64", got.revision().encoding());
        assertEquals(b64, got.content());
        assertEquals(PmDesignContent.sha256Hex(raw), got.revision().sha256());
        assertEquals(PmDesignContent.sha256Hex(raw), got.source().hash());
        assertEquals("design/home.pen", got.source().path());
    }

    @Test
    void penRejectsExcalidrawPayloadField() {
        CreateInput in = new CreateInput(projectA, null, "p", "pen", "{}", null, null, null, null);
        assertCode(400, () -> service.create(TENANT, USER_A, in, "web"));
    }

    @Test
    void changedSourceSinceBaseIsConflict() {
        String b64v1 = Base64.getEncoder().encodeToString(pen("A", "一覧"));
        String b64v2 = Base64.getEncoder().encodeToString(pen("A", "一覧", "B", "詳細"));
        SourceInput src = new SourceInput(null, "main", "design/a.pen", null);
        PmDesignVO vo = service.create(TENANT, USER_A,
            new CreateInput(projectA, null, "a", "pen", null, b64v1, "a.pen", null, src), "web");
        // 取り込み元の基準ハッシュが記録と違う = Git 側が別経路で変わっている
        SaveInput stale = new SaveInput(1, null, b64v2, "a.pen", null, src, "deadbeef");
        assertCode(409, () -> service.save(vo.id(), TENANT, USER_A, stale, "web"));
        SaveInput ok = new SaveInput(1, null, b64v2, "a.pen", null, src, vo.source().hash());
        assertEquals(2, service.save(vo.id(), TENANT, USER_A, ok, "web").currentRevision());
    }

    @Test
    void sourcePathMustBeRelativeWithoutTraversal() {
        SourceInput bad = new SourceInput(null, null, "../../etc/passwd", null);
        String b64 = Base64.getEncoder().encodeToString(pen("A", "一覧"));
        assertCode(400, () -> service.create(TENANT, USER_A,
            new CreateInput(projectA, null, "a", "pen", null, b64, null, null, bad), "web"));
        SourceInput abs = new SourceInput(null, null, "/abs/a.pen", null);
        assertCode(400, () -> service.create(TENANT, USER_A,
            new CreateInput(projectA, null, "a", "pen", null, b64, null, null, abs), "web"));
        SourceInput token = new SourceInput("https://user:ghp_secret@github.com/x/y.git", null, "a.pen", null);
        assertCode(400, () -> service.create(TENANT, USER_A,
            new CreateInput(projectA, null, "a", "pen", null, b64, null, null, token), "web"));
    }

    @Test
    void penSaveSyncsTopLevelFramesAndKeepsReviewStatus() {
        String v1 = Base64.getEncoder().encodeToString(pen("A", "一覧", "B", "詳細"));
        PmDesignVO vo = service.create(TENANT, USER_A,
            new CreateInput(projectA, null, "lms", "pen", null, v1, "lms.pen", null, null), "web");
        assertEquals(List.of("A", "B"), frameIds(vo.id(), false));
        frames.get(vo.id() + "/A").setReviewStatus("approved");

        // A は改名、B は削除、C を追加
        String v2 = Base64.getEncoder().encodeToString(pen("A", "学生一覧", "C", "承認"));
        service.save(vo.id(), TENANT, USER_A, new SaveInput(1, null, v2, "lms.pen", null, null, null), "web");
        PmDesignFrame a = frames.get(vo.id() + "/A");
        assertEquals("学生一覧", a.getName());
        assertEquals("approved", a.getReviewStatus(), "版が変わっても画框の審査ステータスは残る");
        assertEquals(2, a.getLastRevision());
        assertTrue(frames.get(vo.id() + "/B").getRemoved(), "消えた画框は行を残して removed");
        assertEquals(List.of("A", "C"), frameIds(vo.id(), false));
    }

    @Test
    void penThatIsNotJsonIsRejectedBeforeAnyWrite() {
        String b64 = Base64.getEncoder().encodeToString("not json".getBytes(StandardCharsets.UTF_8));
        assertCode(400, () -> service.create(TENANT, USER_A,
            new CreateInput(projectA, null, "a", "pen", null, b64, "a.pen", null, null), "web"));
        assertTrue(designs.isEmpty());
        assertTrue(revisions.isEmpty());
    }

    /** 最上位に画框を並べた最小の .pen（コンポーネント定義と frame 以外のノードも混ぜる） */
    private static byte[] pen(String... idAndNames) {
        StringBuilder sb = new StringBuilder("{\"version\":\"2.6\",\"children\":[");
        sb.append("{\"type\":\"frame\",\"id\":\"cmp\",\"name\":\"Button\",\"reusable\":true},");
        sb.append("{\"type\":\"rectangle\",\"id\":\"r1\"}");
        for (int i = 0; i < idAndNames.length; i += 2) {
            sb.append(",{\"type\":\"frame\",\"id\":\"").append(idAndNames[i])
                .append("\",\"name\":\"").append(idAndNames[i + 1]).append("\",\"children\":[]}");
        }
        return sb.append("]}").toString().getBytes(StandardCharsets.UTF_8);
    }

    private List<String> frameIds(UUID designId, boolean includeRemoved) {
        return frames.values().stream()
            .filter(f -> f.getDesignId().equals(designId) && (includeRemoved || !f.getRemoved()))
            .sorted(Comparator.comparing(PmDesignFrame::getSortOrder))
            .map(PmDesignFrame::getNodeId).toList();
    }

    // ------------------------------------------------------------------ 審査コメント（A7 / A4）

    @Test
    void commentCarriesRevisionAndAuthorAndRejectsBlank() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("v1")), "web");
        service.save(vo.id(), TENANT, USER_A, save(1, scene("v2")), "web");
        PmDesignCommentVO c = service.addComment(vo.id(), TENANT, USER_B, 1, null, "  矢印の向きを確認  ", "web");
        assertEquals(1, c.revision());
        assertEquals("Bob", c.authorName());
        assertEquals("矢印の向きを確認", c.body());
        assertFalse(c.resolved());
        assertCode(400, () -> service.addComment(vo.id(), TENANT, USER_B, 1, null, "   \n ", "web"));
        assertCode(400, () -> service.addComment(vo.id(), TENANT, USER_B, 9, null, "未来の版", "web"));
        assertCode(400, () -> service.addComment(vo.id(), TENANT, USER_B, 1, null, "x".repeat(4001), "web"));
        assertEquals(1, service.listComments(vo.id(), TENANT, USER_B, 1).size());
        assertEquals(0, service.listComments(vo.id(), TENANT, USER_B, 2).size());
        assertTrue(service.listComments(vo.id(), TENANT, USER_B, null).get(0).mine());
        assertFalse(service.listComments(vo.id(), TENANT, USER_A, null).get(0).mine());
    }

    @Test
    void onlyAuthorEditsOrDeletesButAnyMemberResolves() {
        PmDesignVO vo = service.create(TENANT, USER_A, excalidraw(projectA, null, null), "web");
        PmDesignCommentVO c = service.addComment(vo.id(), TENANT, USER_A, 1, null, "要確認", "web");
        assertCode(403, () -> service.editComment(c.id(), TENANT, USER_B, "書き換え"));
        assertCode(403, () -> service.deleteComment(c.id(), TENANT, USER_B));
        assertEquals("修正済み", service.editComment(c.id(), TENANT, USER_A, "修正済み").body());

        PmDesignCommentVO resolved = service.resolveComment(c.id(), TENANT, USER_B, true);
        assertTrue(resolved.resolved());
        assertEquals("Bob", resolved.resolvedByName());
        assertTrue(comments.get(c.id()).getResolved(), "解決状態は永続化される");
        assertFalse(service.resolveComment(c.id(), TENANT, USER_A, false).resolved());

        assertCode(403, () -> service.editComment(c.id(), OTHER_TENANT, USER_A, "x"));
        service.deleteComment(c.id(), TENANT, USER_A);
        assertEquals(0, service.listComments(vo.id(), TENANT, USER_A, null).size());
    }

    // ------------------------------------------------------------------ helpers

    private static String scene(String elementId) {
        return "{\"type\":\"excalidraw\",\"elements\":[{\"id\":\"" + elementId
            + "\",\"type\":\"rectangle\",\"x\":0,\"y\":0}],\"appState\":{},\"files\":{}}";
    }

    private static CreateInput excalidraw(UUID projectId, UUID taskId, String content) {
        return new CreateInput(projectId, taskId, "白板", "excalidraw", content, null, null, null, null);
    }

    private static SaveInput save(Integer expected, String content) {
        return new SaveInput(expected, content, null, null, null, null, null);
    }

    private static void assertCode(int code, Executable ex) {
        BizException e = assertThrows(BizException.class, ex);
        assertEquals(code, e.getCode(), e.getMessage());
    }

    private List<PmDesignRevision> revisionsOf(UUID designId) {
        return revisions.stream().filter(r -> r.getDesignId().equals(designId))
            .sorted(Comparator.comparing(PmDesignRevision::getRevision)).toList();
    }

    private UUID project(UUID tenantId) {
        PmProject p = new PmProject();
        p.setId(UUID.randomUUID());
        p.setTenantId(tenantId);
        p.setName("P-" + p.getId().toString().substring(0, 4));
        projects.put(p.getId(), p);
        return p.getId();
    }

    private UUID task(UUID projectId) {
        PmTask t = new PmTask();
        t.setId(UUID.randomUUID());
        t.setTenantId(projects.get(projectId).getTenantId());
        t.setProjectId(projectId);
        t.setName("T-" + t.getId().toString().substring(0, 4));
        tasks.put(t.getId(), t);
        return t.getId();
    }

    @Test
    void renamePreservesRevisionSavedAfterItsRead() {
        PmDesignVO d = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("a")), "web");
        beforeDesignMutation = () -> service.save(d.id(), TENANT, USER_B,
            save(1, scene("b")), "mcp");
        service.updateMeta(d.id(), TENANT, USER_A, "renamed", null, false);
        assertEquals(2, service.get(d.id(), TENANT, null).currentRevision());
        assertEquals("renamed", designs.get(d.id()).getTitle());
        assertEquals(2, revisionsOf(d.id()).size());
    }

    @Test
    void renameCannotResurrectDesignDeletedAfterItsRead() {
        PmDesignVO d = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("a")), "web");
        beforeDesignMutation = () -> service.delete(d.id(), TENANT, USER_B);
        assertCode(404, () -> service.updateMeta(d.id(), TENANT, USER_A, "renamed", null, false));
        assertTrue(designs.get(d.id()).getDeletedAt() != null);
    }

    @Test
    void deleteKeepsRevisionSavedAfterItsRead() {
        PmDesignVO d = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("a")), "web");
        beforeDesignMutation = () -> service.save(d.id(), TENANT, USER_B,
            save(1, scene("b")), "web");
        service.delete(d.id(), TENANT, USER_A);
        assertEquals(2, designs.get(d.id()).getCurrentRevision());
        assertTrue(designs.get(d.id()).getDeletedAt() != null);
    }

    @Test
    void resolveKeepsBodyEditedAfterItsRead() {
        PmDesignVO d = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("a")), "web");
        PmDesignCommentVO c = service.addComment(d.id(), TENANT, USER_A, 1, null, "old body", "web");
        beforeCommentMutation = () -> service.editComment(c.id(), TENANT, USER_A, "new body");
        service.resolveComment(c.id(), TENANT, USER_B, true);
        assertEquals("new body", comments.get(c.id()).getBody());
        assertTrue(comments.get(c.id()).getResolved());
    }

    @Test
    void editKeepsResolutionChangedAfterItsRead() {
        PmDesignVO d = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("a")), "web");
        PmDesignCommentVO c = service.addComment(d.id(), TENANT, USER_A, 1, null, "old body", "web");
        beforeCommentMutation = () -> service.resolveComment(c.id(), TENANT, USER_B, true);
        service.editComment(c.id(), TENANT, USER_A, "new body");
        assertTrue(comments.get(c.id()).getResolved());
        assertEquals("new body", comments.get(c.id()).getBody());
    }

    @Test
    void resolveCannotResurrectCommentDeletedAfterItsRead() {
        PmDesignVO d = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("a")), "web");
        PmDesignCommentVO c = service.addComment(d.id(), TENANT, USER_A, 1, null, "body", "web");
        beforeCommentMutation = () -> service.deleteComment(c.id(), TENANT, USER_A);
        assertCode(404, () -> service.resolveComment(c.id(), TENANT, USER_B, true));
        assertTrue(comments.get(c.id()).getDeletedAt() != null);
    }

    @Test
    void editCannotResurrectCommentDeletedAfterItsRead() {
        PmDesignVO d = service.create(TENANT, USER_A, excalidraw(projectA, null, scene("a")), "web");
        PmDesignCommentVO c = service.addComment(d.id(), TENANT, USER_A, 1, null, "body", "web");
        beforeCommentMutation = () -> service.deleteComment(c.id(), TENANT, USER_A);
        assertCode(404, () -> service.editComment(c.id(), TENANT, USER_A, "new body"));
        assertTrue(comments.get(c.id()).getDeletedAt() != null);
    }

    private static PmDesignComment copy(PmDesignComment d) {
        PmDesignComment c = new PmDesignComment();
        c.setId(d.getId());
        c.setTenantId(d.getTenantId());
        c.setDesignId(d.getDesignId());
        c.setRevision(d.getRevision());
        c.setBody(d.getBody());
        c.setResolved(d.getResolved());
        c.setAuthorUserId(d.getAuthorUserId());
        c.setAuthorName(d.getAuthorName());
        c.setResolvedBy(d.getResolvedBy());
        c.setResolvedByName(d.getResolvedByName());
        c.setResolvedAt(d.getResolvedAt());
        c.setVia(d.getVia());
        c.setCreatedAt(d.getCreatedAt());
        c.setUpdatedAt(d.getUpdatedAt());
        c.setDeletedAt(d.getDeletedAt());
        return c;
    }

    private static PmDesign copy(PmDesign d) {
        PmDesign c = new PmDesign();
        c.setId(d.getId());
        c.setTenantId(d.getTenantId());
        c.setProjectId(d.getProjectId());
        c.setTaskId(d.getTaskId());
        c.setTitle(d.getTitle());
        c.setFormat(d.getFormat());
        c.setCurrentRevision(d.getCurrentRevision());
        c.setSourceRepo(d.getSourceRepo());
        c.setSourceRef(d.getSourceRef());
        c.setSourcePath(d.getSourcePath());
        c.setSourceCommitSha(d.getSourceCommitSha());
        c.setSourceHash(d.getSourceHash());
        c.setCreatedBy(d.getCreatedBy());
        c.setCreatedByName(d.getCreatedByName());
        c.setUpdatedBy(d.getUpdatedBy());
        c.setUpdatedByName(d.getUpdatedByName());
        c.setCreatedAt(d.getCreatedAt());
        c.setUpdatedAt(d.getUpdatedAt());
        c.setDeletedAt(d.getDeletedAt());
        return c;
    }

    private PmDesignMapper designMapper() {
        return fake(PmDesignMapper.class, (m, a) -> switch (m) {
            case "insert" -> {
                PmDesign d = (PmDesign) a[0];
                designs.put(d.getId(), copy(d));
                yield 1;
            }
            case "selectOneById" -> {
                PmDesign d = designs.get((UUID) a[0]);
                yield d == null ? null : copy(d);
            }
            case "update" -> {
                interceptDesignMutation();
                PmDesign d = (PmDesign) a[0];
                designs.put(d.getId(), copy(d));
                yield 1;
            }
            case "updateMetaFields", "softDelete" -> {
                interceptDesignMutation();
                PmDesign d = designs.get((UUID) a[1]);
                if (d == null || !d.getTenantId().equals(a[0]) || d.getDeletedAt() != null) yield 0;
                if (m.equals("softDelete")) {
                    d.setDeletedAt(java.time.LocalDateTime.now());
                } else {
                    if (a[2] != null) d.setTitle((String) a[2]);
                    if ((boolean) a[3]) d.setTaskId((UUID) a[4]);
                    d.setUpdatedBy((UUID) a[5]);
                    d.setUpdatedByName((String) a[6]);
                }
                d.setUpdatedAt(java.time.LocalDateTime.now());
                yield 1;
            }
            case "advanceRevision" -> {
                if (beforeCas != null) {
                    beforeCas.run();
                    beforeCas = null;
                }
                PmDesign d = designs.get((UUID) a[1]);
                if (d == null || !d.getTenantId().equals(a[0]) || d.getCurrentRevision() != (int) a[2]
                    || d.getDeletedAt() != null) {
                    yield 0;
                }
                d.setCurrentRevision((int) a[3]);
                d.setUpdatedBy((UUID) a[4]);
                d.setUpdatedByName((String) a[5]);
                if (a[6] != null) d.setSourceRepo((String) a[6]);
                if (a[7] != null) d.setSourceRef((String) a[7]);
                if (a[8] != null) d.setSourcePath((String) a[8]);
                if (a[9] != null) d.setSourceCommitSha((String) a[9]);
                if (a[10] != null) d.setSourceHash((String) a[10]);
                yield 1;
            }
            case "selectLive" -> designs.values().stream()
                .filter(d -> d.getTenantId().equals(a[0]) && d.getDeletedAt() == null)
                .filter(d -> a[2] != null ? a[2].equals(d.getTaskId()) : a[1].equals(d.getProjectId()))
                .map(PmDesignServiceTest::copy).toList();
            default -> throw new UnsupportedOperationException(m);
        });
    }

    private PmDesignRevisionMapper revisionMapper() {
        return fake(PmDesignRevisionMapper.class, (m, a) -> switch (m) {
            case "insert" -> {
                PmDesignRevision r = (PmDesignRevision) a[0];
                boolean dup = revisions.stream().anyMatch(x -> x.getDesignId().equals(r.getDesignId())
                    && x.getRevision().equals(r.getRevision()));
                if (dup) {
                    throw new IllegalStateException("unique violation ux_pm_design_revision");
                }
                revisions.add(r);
                yield 1;
            }
            case "selectMetaByDesigns" -> revisions.stream()
                .filter(r -> r.getTenantId().equals(a[0]) && ((List<?>) a[1]).contains(r.getDesignId()))
                .sorted(Comparator.comparing(PmDesignRevision::getRevision).reversed()).toList();
            case "selectOne" -> revisions.stream()
                .filter(r -> r.getTenantId().equals(a[0]) && r.getDesignId().equals(a[1])
                    && r.getRevision() == (int) a[2]).findFirst().orElse(null);
            default -> throw new UnsupportedOperationException(m);
        });
    }

    private PmDesignCommentMapper commentMapper() {
        return fake(PmDesignCommentMapper.class, (m, a) -> switch (m) {
            case "insert", "update" -> {
                if (m.equals("update")) interceptCommentMutation();
                PmDesignComment c = (PmDesignComment) a[0];
                comments.put(c.getId(), copy(c));
                yield 1;
            }
            case "editBody", "setResolved", "softDelete" -> {
                interceptCommentMutation();
                PmDesignComment c = comments.get((UUID) a[1]);
                if (c == null || !c.getTenantId().equals(a[0]) || c.getDeletedAt() != null) yield 0;
                if (m.equals("setResolved")) {
                    c.setResolved((boolean) a[2]);
                    c.setResolvedBy((UUID) a[3]);
                    c.setResolvedByName((String) a[4]);
                    c.setResolvedAt((java.time.LocalDateTime) a[5]);
                } else {
                    if (!c.getAuthorUserId().equals(a[2])) yield 0;
                    if (m.equals("editBody")) c.setBody((String) a[3]);
                    else c.setDeletedAt(java.time.LocalDateTime.now());
                }
                c.setUpdatedAt(java.time.LocalDateTime.now());
                yield 1;
            }
            case "selectOneById" -> {
                PmDesignComment c = comments.get((UUID) a[0]);
                yield c == null ? null : copy(c);
            }
            case "selectLive" -> comments.values().stream()
                .filter(c -> c.getTenantId().equals(a[0]) && c.getDesignId().equals(a[1]) && c.getDeletedAt() == null)
                .filter(c -> a[2] == null || a[2].equals(c.getRevision()))
                .sorted(Comparator.comparing(PmDesignComment::getCreatedAt)).toList();
            default -> throw new UnsupportedOperationException(m);
        });
    }

    private PmDesignFrameMapper frameMapper() {
        return fake(PmDesignFrameMapper.class, (m, a) -> switch (m) {
            case "upsertSeen" -> {
                PmDesignFrame f = frames.computeIfAbsent(a[1] + "/" + a[2], k -> {
                    PmDesignFrame n = new PmDesignFrame();
                    n.setTenantId((UUID) a[0]);
                    n.setDesignId((UUID) a[1]);
                    n.setNodeId((String) a[2]);
                    n.setReviewStatus("draft");
                    return n;
                });
                f.setName((String) a[3]);
                f.setSortOrder((int) a[4]);
                f.setLastRevision((int) a[5]);
                f.setRemoved(false);
                yield 1;
            }
            case "markMissingRemoved" -> {
                int n = 0;
                for (PmDesignFrame f : frames.values()) {
                    if (f.getTenantId().equals(a[0]) && f.getDesignId().equals(a[1])
                        && f.getLastRevision() < (int) a[2] && !f.getRemoved()) {
                        f.setRemoved(true);
                        n++;
                    }
                }
                yield n;
            }
            default -> throw new UnsupportedOperationException(m);
        });
    }

    private interface Handler {
        Object call(String method, Object[] args);
    }

    /** Mapper インタフェースの内存実装。メソッド名で振り分け、未対応は即例外（暗黙の成功を作らない）。 */
    @SuppressWarnings("unchecked")
    private static <T> T fake(Class<T> type, Handler handler) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, (proxy, method, args) -> {
            if (method.getDeclaringClass() == Object.class) {
                return switch (method.getName()) {
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    default -> type.getSimpleName() + "Fake";
                };
            }
            return handler.call(method.getName(), args == null ? new Object[0] : args);
        });
    }
}

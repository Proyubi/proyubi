package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.mapper.PmProjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Proxy;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * サブプロジェクトの階層ルール（{@link PmProjectHierarchyRules}）と、
 * {@link PmProjectService} の作成/更新/削除がそれを適用していることの検証。
 * DB は JDK Proxy の内存 Mapper（selectOneById のみ）＋ childCount を差し替えた進捗サービスで代替。
 */
class PmProjectHierarchyTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID CUSTOMER_A = UUID.randomUUID();
    private static final UUID CUSTOMER_B = UUID.randomUUID();

    private final Map<UUID, PmProject> projects = new HashMap<>();
    private final Map<UUID, Long> childCounts = new HashMap<>();
    private PmProjectService service;

    private PmProject project(UUID customerId, UUID parentId, String kind) {
        PmProject p = new PmProject();
        p.setId(UUID.randomUUID());
        p.setTenantId(TENANT);
        p.setCustomerId(customerId);
        p.setParentId(parentId);
        p.setKind(kind);
        p.setStatus("active");
        p.setStart(LocalDate.parse("2026-09-01"));
        p.setEnd(LocalDate.parse("2027-01-31"));
        projects.put(p.getId(), p);
        return p;
    }

    @BeforeEach
    void setUp() {
        PmProjectMapper mapper = (PmProjectMapper) Proxy.newProxyInstance(
            PmProjectMapper.class.getClassLoader(), new Class<?>[]{PmProjectMapper.class},
            (proxy, method, args) -> {
                if ("selectOneById".equals(method.getName())) {
                    return projects.get((UUID) args[0]);
                }
                if ("update".equals(method.getName())) return 1;
                throw new UnsupportedOperationException(method.getName());
            });
        PmProjectProgressService progress = new PmProjectProgressService(mapper, null, null, null, null) {
            @Override
            public void recomputeParent(UUID tenantId, UUID parentId) {
            }

            @Override
            public long childCount(UUID tenantId, UUID parentId) {
                return childCounts.getOrDefault(parentId, 0L);
            }
        };
        PmTeamScopeService teamScope = new PmTeamScopeService(null) {
            @Override
            public void assertTeamVisible(UUID teamId) {
            }
        };
        service = new PmProjectService(mapper, null, null, null, teamScope, null, null, null, null, progress) {
            @Override
            public PmProject getByIdAndTenant(UUID id, UUID tenantId) {
                PmProject p = projects.get(id);
                if (p == null || p.getDeletedAt() != null) {
                    throw BizException.of(404, "项目不存在");
                }
                return p;
            }
        };
    }

    private static int code(Runnable r) {
        BizException e = assertThrows(BizException.class, r::run);
        return e.getCode();
    }

    // ---- 純関数ルール ----

    @Test
    void topLevelProjectCanBeParent() {
        PmProject parent = project(CUSTOMER_A, null, "project");
        assertDoesNotThrow(() -> PmProjectHierarchyRules.validateParent(null, false, null, TENANT, parent));
        assertDoesNotThrow(() -> PmProjectHierarchyRules.validateParent(null, false, "project", TENANT, parent));
    }

    @Test
    void parentMustExistInSameTenantAndNotDeleted() {
        assertEquals(404, code(() -> PmProjectHierarchyRules.validateParent(null, false, null, TENANT, null)));
        PmProject other = project(CUSTOMER_A, null, "project");
        other.setTenantId(UUID.randomUUID());
        assertEquals(404, code(() -> PmProjectHierarchyRules.validateParent(null, false, null, TENANT, other)));
        PmProject deleted = project(CUSTOMER_A, null, "project");
        deleted.setDeletedAt(LocalDateTime.now());
        assertEquals(404, code(() -> PmProjectHierarchyRules.validateParent(null, false, null, TENANT, deleted)));
    }

    @Test
    void oneLevelOnly() {
        PmProject top = project(CUSTOMER_A, null, "project");
        PmProject sub = project(CUSTOMER_A, top.getId(), "project");
        // サブの下にサブは作れない
        assertEquals(400, code(() -> PmProjectHierarchyRules.validateParent(null, false, null, TENANT, sub)));
        // サブを持つ案件は子になれない
        PmProject other = project(CUSTOMER_A, null, "project");
        assertEquals(400, code(() -> PmProjectHierarchyRules.validateParent(top.getId(), true, null, TENANT, other)));
        // 自分自身は親にできない
        assertEquals(400, code(() -> PmProjectHierarchyRules.validateParent(top.getId(), false, null, TENANT, top)));
    }

    @Test
    void opsCannotBeParentNorChild() {
        PmProject ops = project(CUSTOMER_A, null, "ops");
        assertEquals(400, code(() -> PmProjectHierarchyRules.validateParent(null, false, null, TENANT, ops)));
        PmProject top = project(CUSTOMER_A, null, null);   // kind=null は project 扱い
        assertDoesNotThrow(() -> PmProjectHierarchyRules.validateParent(null, false, null, TENANT, top));
        assertEquals(400, code(() -> PmProjectHierarchyRules.validateParent(null, false, "ops", TENANT, top)));
        assertEquals(400, code(() -> PmProjectHierarchyRules.validateKindChangeForParent(true, "ops")));
        assertDoesNotThrow(() -> PmProjectHierarchyRules.validateKindChangeForParent(false, "ops"));
    }

    @Test
    void sameLevelForReorder() {
        PmProject top = project(CUSTOMER_A, null, "project");
        PmProject sub = project(CUSTOMER_A, top.getId(), "project");
        assertTrue(PmProjectHierarchyRules.sameLevel(top, null));
        assertFalse(PmProjectHierarchyRules.sameLevel(sub, null));
        assertTrue(PmProjectHierarchyRules.sameLevel(sub, top.getId()));
        assertFalse(PmProjectHierarchyRules.sameLevel(sub, UUID.randomUUID()));
        assertFalse(PmProjectHierarchyRules.sameLevel(top, top.getId()));
    }

    // ---- サービスへの適用 ----

    @Test
    void deleteParentWithChildrenIsRejected() {
        PmProject parent = project(CUSTOMER_A, null, "project");
        childCounts.put(parent.getId(), 2L);
        BizException e = assertThrows(BizException.class, () -> service.delete(parent.getId(), TENANT));
        assertEquals(400, e.getCode());
        assertTrue(e.getMessage().contains("サブプロジェクトがあるため削除できません"));
        assertTrue(parent.getDeletedAt() == null);
    }

    @Test
    void createUnderSubProjectIsRejected() {
        PmProject top = project(CUSTOMER_A, null, "project");
        PmProject sub = project(CUSTOMER_A, top.getId(), "project");
        assertEquals(400, code(() -> service.create(TENANT, CUSTOMER_A, "x", null, "planned", null,
            LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-31"), null, sub.getId())));
    }

    @Test
    void createUnderOpsOrMissingParentIsRejected() {
        PmProject ops = project(CUSTOMER_A, null, "ops");
        assertEquals(400, code(() -> service.create(TENANT, CUSTOMER_A, "x", null, "planned", null,
            LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-31"), null, ops.getId())));
        assertEquals(404, code(() -> service.create(TENANT, CUSTOMER_A, "x", null, "planned", null,
            LocalDate.parse("2026-10-01"), LocalDate.parse("2026-10-31"), null, UUID.randomUUID())));
    }

    @Test
    void reparentAcrossCustomersIsRejected() {
        PmProject parentInB = project(CUSTOMER_B, null, "project");
        PmProject p = project(CUSTOMER_A, null, "project");
        assertEquals(400, code(() -> service.update(p.getId(), TENANT, null, null, null, null, null,
            null, null, false, null, parentInB.getId(), false)));
        // customerId と parentId を同時指定しても顧客をまたぐ付け替えは許可しない。
        assertEquals(400, code(() -> service.update(p.getId(), TENANT, CUSTOMER_B, null, null, null, null,
            null, null, false, null, parentInB.getId(), false)));
        assertEquals(null, p.getParentId());
    }

    @Test
    void omittedParentPreservesExistingHierarchyAndInheritsTeam() {
        PmProject parent = project(CUSTOMER_A, null, "project");
        parent.setTeamId(UUID.randomUUID());
        PmProject child = project(CUSTOMER_A, parent.getId(), "project");
        PmProject updated = service.update(child.getId(), TENANT, null, "renamed", null, null, null,
            null, null, false, null, null, false);
        assertEquals(parent.getId(), updated.getParentId());
        assertEquals(parent.getTeamId(), updated.getTeamId());
        assertEquals("renamed", updated.getName());
    }

    @Test
    void existingParentIsValidatedEvenWhenFieldIsOmitted() {
        PmProject parent = project(CUSTOMER_A, null, "project");
        PmProject child = project(CUSTOMER_A, parent.getId(), "project");
        parent.setTenantId(UUID.randomUUID());
        assertEquals(404, code(() -> service.update(child.getId(), TENANT, null, "renamed", null, null,
            null, null, null, false, null, null, false)));
    }

    @Test
    void projectWithChildrenCannotBecomeChild() {
        PmProject other = project(CUSTOMER_A, null, "project");
        PmProject p = project(CUSTOMER_A, null, "project");
        childCounts.put(p.getId(), 1L);
        assertEquals(400, code(() -> service.update(p.getId(), TENANT, null, null, null, null, null,
            null, null, false, null, other.getId(), false)));
    }
}

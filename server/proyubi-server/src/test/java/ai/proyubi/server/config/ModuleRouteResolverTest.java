package ai.proyubi.server.config;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * {@link ModuleRouteResolver} 映射契约测试（覆盖 R4）。
 *
 * <p><b>纪律</b>：新增模块 / 新增 {@code /app/**} 前缀时，PR 必须同步更新
 * {@link ModuleRouteResolver} 与本测试——枚举断言是「前缀归属」唯一的回归护栏。
 * 漏更新本测试 = 漏 enforce 该前缀（resolver 返回 null 默认放行）。
 */
class ModuleRouteResolverTest {

    // ── PM ──────────────────────────────────────────────────────────────────
    @Test
    void pmPrefixes() {
        assertEquals("pm", ModuleRouteResolver.resolve("/app/pm"));
        assertEquals("pm", ModuleRouteResolver.resolve("/app/pm/projects"));
        assertEquals("pm", ModuleRouteResolver.resolve("/app/pm/customers"));
        assertEquals("pm", ModuleRouteResolver.resolve("/app/pm/members/available"));
        assertEquals("pm", ModuleRouteResolver.resolve("/app/pm/holidays"));
        assertEquals("pm", ModuleRouteResolver.resolve("/app/pm/mindmaps"));
        assertEquals("pm", ModuleRouteResolver.resolve("/app/pm/roadmap-options"));
    }

    // ── BK ──────────────────────────────────────────────────────────────────
    @Test
    void bkPrefixes() {
        assertEquals("bk", ModuleRouteResolver.resolve("/app/bk"));
        assertEquals("bk", ModuleRouteResolver.resolve("/app/bk/ledger"));
        assertEquals("bk", ModuleRouteResolver.resolve("/app/expense"));
        assertEquals("bk", ModuleRouteResolver.resolve("/app/expense/list"));
        assertEquals("bk", ModuleRouteResolver.resolve("/app/envelope"));
    }

    // ── WMS（核心）──────────────────────────────────────────────────────────
    @Test
    void wmsCorePrefixes() {
        assertEquals("wms", ModuleRouteResolver.resolve("/app/product"));
        assertEquals("wms", ModuleRouteResolver.resolve("/app/product/list"));
        assertEquals("wms", ModuleRouteResolver.resolve("/app/stock"));
        assertEquals("wms", ModuleRouteResolver.resolve("/app/sku"));
        assertEquals("wms", ModuleRouteResolver.resolve("/app/transaction"));
        assertEquals("wms", ModuleRouteResolver.resolve("/app/contact"));
        assertEquals("wms", ModuleRouteResolver.resolve("/app/inventory-check"));
        assertEquals("wms", ModuleRouteResolver.resolve("/app/analytics"));
    }

    // ── 共享/账号级/附加能力/未登记：放行(null) ──────────────────────────────
    @Test
    void sharedAndAccountPrefixesPassThrough() {
        assertNull(ModuleRouteResolver.resolve("/app/auth/me"));
        assertNull(ModuleRouteResolver.resolve("/app/auth/login"));
        assertNull(ModuleRouteResolver.resolve("/app/team/teams"));
        assertNull(ModuleRouteResolver.resolve("/app/team/invitations"));
        assertNull(ModuleRouteResolver.resolve("/app/settings"));
        assertNull(ModuleRouteResolver.resolve("/app/settings/app-icon"));
        assertNull(ModuleRouteResolver.resolve("/app/invitations"));
        assertNull(ModuleRouteResolver.resolve("/app/upload"));
        assertNull(ModuleRouteResolver.resolve("/app/bootstrap/pm-web-jp"));
        assertNull(ModuleRouteResolver.resolve("/app/subscription"));
        assertNull(ModuleRouteResolver.resolve("/app/notices"));
        assertNull(ModuleRouteResolver.resolve("/app/feedback"));
        // 附加能力：report / ai 不单独售卖 → 不强制 grant
        assertNull(ModuleRouteResolver.resolve("/app/report"));
        assertNull(ModuleRouteResolver.resolve("/app/ai"));
        assertNull(ModuleRouteResolver.resolve("/app/ai/usage"));
    }

    // ── 边界：前缀不得误命中相邻路径 / null 安全 ──────────────────────────────
    @Test
    void boundariesAndNullSafety() {
        assertNull(ModuleRouteResolver.resolve(null));
        // /app/stockX 不应命中 /app/stock
        assertNull(ModuleRouteResolver.resolve("/app/stockroom"));
        // /app/products（复数，无该 controller）不应命中 /app/product
        assertNull(ModuleRouteResolver.resolve("/app/productsX"));
    }
}

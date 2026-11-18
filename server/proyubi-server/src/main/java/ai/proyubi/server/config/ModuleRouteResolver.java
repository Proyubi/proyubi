package ai.proyubi.server.config;

/**
 * 路由 → 模块解析（freee 模型 A 网关）。
 *
 * <h2>纪律（R4/R5）</h2>
 * <ul>
 *   <li><b>禁止用 appCode 判 module</b>：{@code user-web-jp} 一壳承载 wms+bk，
 *       appCode 判不出该请求属于哪个模块（R5）。以 URL 前缀为唯一主键。</li>
 *   <li><b>新增模块前缀必须在此登记</b>，并在 {@code ModuleRouteResolverTest} 的枚举断言里同步
 *       追加（R4）。漏登记 = 该前缀默认放行（见下）。</li>
 *   <li><b>白名单式 enforce</b>：未登记前缀 {@code resolve()=null} → 放行。小团队下「漏 enforce」
 *       的代价（某模块没拦住）远小于「误锁死」的代价（共享/账号端点被 403），故倾向放行。</li>
 * </ul>
 *
 * <h2>模块归属（按 controller 实读）</h2>
 * <ul>
 *   <li><b>pm</b>：{@code /app/pm/**}（含 customers/projects/members/holidays/mindmaps/...）。</li>
 *   <li><b>bk</b>：{@code /app/bk}、{@code /app/expense}、{@code /app/envelope}。bk 虽与 wms-web
 *       共用 {@code user-web-jp} 外壳，但端点前缀独立 → 按 bk 模块准入（模型 A 按模块独立准入）。
 *       owner 三模块 grant 齐全、②回填覆盖 bk grant，故不增误伤。</li>
 *   <li><b>wms</b>：核心 WMS（product/stock/sku/transaction/contact/inventory-check/
 *       analytics）。</li>
 *   <li><b>放行(null)</b>：账号/共享/附加能力端点——auth、bootstrap、team、settings、invitations、
 *       upload、subscription、notices、feedback、report（附加）、ai（跨模块附加）等未登记前缀。</li>
 * </ul>
 */
public final class ModuleRouteResolver {

    private ModuleRouteResolver() {}

    /**
     * 返回该路径要求的模块 code（wms/pm/bk）；null = 跨模块/共享/未登记 → 放行。
     */
    public static String resolve(String uri) {
        if (uri == null) {
            return null;
        }

        // ── PM ──────────────────────────────────────────────────────────────
        if (uri.startsWith("/app/pm/") || uri.equals("/app/pm")) {
            return "pm";
        }

        // ── BK（记账；user-web-jp 壳内但路径独立 → 挂 bk grant）──────────────────
        if (prefix(uri, "/app/bk")
                || prefix(uri, "/app/expense")
                || prefix(uri, "/app/envelope")) {
            return "bk";
        }

        // ── WMS（核心在库管理）────────────────────────────────────────────────
        if (prefix(uri, "/app/product")
                || prefix(uri, "/app/stock")
                || prefix(uri, "/app/sku")
                || prefix(uri, "/app/transaction")
                || prefix(uri, "/app/contact")
                || prefix(uri, "/app/inventory-check")
                || prefix(uri, "/app/analytics")) {
            return "wms";
        }

        // 共享/账号级/附加能力/未登记：放行
        return null;
    }

    /** 前缀匹配：命中 {@code base} 整段或 {@code base/} 子路径，避免 /app/stockX 误命中 /app/stock。 */
    private static boolean prefix(String uri, String base) {
        return uri.equals(base) || uri.startsWith(base + "/");
    }
}

package ai.proyubi.common.mybatisflex.tenant;

import ai.proyubi.common.core.context.TenantContext;
import com.mybatisflex.core.tenant.TenantFactory;

import java.util.UUID;

/**
 * Proyubi 租户工厂（R1 多租户隔离收口）。
 *
 * <p>MyBatis-Flex 在为带 {@code tenant_id} 列的实体构建 SQL 时会调用本工厂取当前租户：
 * <ul>
 *   <li>返回非空数组 → 框架自动追加 {@code AND tenant_id = ?}（SELECT/UPDATE/DELETE），
 *       并在 INSERT 时回填空的 {@code tenant_id}（已手动 set 的值不会被覆盖）。</li>
 *   <li>返回 {@code null} → 不追加任何条件（与未启用隔离一致）。</li>
 * </ul>
 *
 * <p>隔离的「失败开放」语义是刻意的、安全的：
 * <ul>
 *   <li><b>有租户上下文</b>（已登录的 {@code /app/**} 请求，由 {@code TenantContextInterceptor}
 *       从 Sa-Token Session 写入）→ 强制隔离。这正是 R1 要堵的「漏一个查询就泄露」。</li>
 *   <li><b>无租户上下文</b>（登录/注册/OAuth、平台后台 {@code /ops/**}、Stripe/LINE Webhook、
 *       定时任务）→ 返回 null，行为与改造前完全一致，不会误伤这些「天然跨租户/无租户」的流程。</li>
 *   <li><b>SINGLE 模式</b>（私有化单租户）→ 恒返回 null，不做过滤。</li>
 * </ul>
 *
 * <p>注意：本工厂只影响实体 CRUD（{@code insert}/{@code selectOneById}/{@code QueryWrapper}/
 * {@code UpdateChain}）。手写的 {@code @Select}/{@code @Update}/XML SQL 不受影响。
 * 现有各 Service 手写的 {@code WHERE tenant_id} / {@code .equals(tenantId)} 校验全部保留，
 * 与本框架层互为双保险。
 *
 */
public class ProyubiTenantFactory implements TenantFactory {

    private final TenancyProperties properties;

    public ProyubiTenantFactory(TenancyProperties properties) {
        this.properties = properties;
    }

    @Override
    public Object[] getTenantIds(String tableName) {
        // 私有化单租户：不做隔离过滤。
        if (properties.getMode() == TenancyProperties.Mode.SINGLE) {
            return null;
        }
        // 无租户上下文（未登录 / 平台后台 / Webhook / 定时任务）→ 不追加条件，保持原行为。
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            return null;
        }
        return new Object[] { tenantId };
    }

    /**
     * 兼容已废弃的无参签名（MyBatis-Flex 默认转调 {@link #getTenantIds(String)}）。
     */
    @Override
    @Deprecated
    public Object[] getTenantIds() {
        return getTenantIds(null);
    }
}

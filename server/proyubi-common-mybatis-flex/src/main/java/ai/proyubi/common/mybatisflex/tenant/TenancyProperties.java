package ai.proyubi.common.mybatisflex.tenant;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 多租户隔离配置（R1 收口）。
 *
 * <p>绑定 {@code proyubi.tenancy.*}，决定 MyBatis-Flex 的 {@code TenantManager} 是否对
 * 带 {@code tenant_id} 列的业务实体自动追加 {@code AND tenant_id = ?} 条件。
 *
 * <ul>
 *   <li>{@link Mode#MULTI MULTI}（默认）：SaaS 多租户。框架强制按当前 {@code TenantContext}
 *       的租户隔离，杜绝「某个 Service 漏写 WHERE tenant_id 即跨租户泄露」。</li>
 *   <li>{@link Mode#SINGLE SINGLE}：私有化单租户部署。整库只有一个租户，无需隔离，
 *       工厂恒返回空（不追加任何条件），与未启用 TenantManager 时的行为一致。</li>
 * </ul>
 *
 */
@ConfigurationProperties(prefix = "proyubi.tenancy")
public class TenancyProperties {

    public enum Mode {
        /** SaaS 多租户：框架强制按 TenantContext 隔离。 */
        MULTI,
        /** 私有化单租户：不做隔离过滤。 */
        SINGLE
    }

    /** 租户模式，默认 MULTI（多租户强制隔离）。 */
    private Mode mode = Mode.MULTI;

    public Mode getMode() {
        return mode;
    }

    public void setMode(Mode mode) {
        this.mode = mode;
    }
}

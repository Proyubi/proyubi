package ai.proyubi.common.mybatisflex.config;

import ai.proyubi.common.mybatisflex.tenant.ProyubiTenantFactory;
import ai.proyubi.common.mybatisflex.tenant.TenancyProperties;
import com.mybatisflex.core.FlexGlobalConfig;
import com.mybatisflex.core.tenant.TenantManager;
import com.mybatisflex.spring.boot.MyBatisFlexCustomizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * MyBatis-Flex 公共配置。
 *
 * 说明：核心配置优先走 spring.datasource 与 mybatis-flex.* 配置项。
 *
 * 注意：MyBatis-Flex 的自动配置由 mybatis-flex-spring-boot3-starter 提供，
 * 确保数据源配置正确后，SqlSessionFactory 会自动创建。
 *
 * 多租户隔离（R1 收口）：MULTI 模式下启用 TenantManager，对带 {@code tenant_id} 列的业务实体
 * 自动追加 {@code AND tenant_id = ?}，租户来自 {@code TenantContext}（见 {@link ProyubiTenantFactory}）。
 */
@Configuration
@EnableConfigurationProperties(TenancyProperties.class)
public class MybatisFlexConfig implements MyBatisFlexCustomizer {

    private static final Logger log = LoggerFactory.getLogger(MybatisFlexConfig.class);

    /** 多租户隔离字段名（所有业务表统一用 tenant_id）。 */
    private static final String TENANT_COLUMN = "tenant_id";

    private final TenancyProperties tenancyProperties;

    public MybatisFlexConfig(TenancyProperties tenancyProperties) {
        this.tenancyProperties = tenancyProperties;
        // 构造期即禁用 banner，确保在 MyBatis-Flex 初始化之前设置
        try {
            FlexGlobalConfig globalConfig = FlexGlobalConfig.getDefaultConfig();
            globalConfig.setPrintBanner(false);
        } catch (Exception e) {
            // 如果获取配置失败，忽略错误（可能在初始化阶段）
        }
    }

    @Override
    public void customize(FlexGlobalConfig globalConfig) {
        globalConfig.setPrintBanner(false);

        if (tenancyProperties.getMode() == TenancyProperties.Mode.MULTI) {
            // 多租户：启用 MyBatis-Flex 租户列自动检测 + TenantManager。
            // 只有「物理上含 tenant_id 列」的实体会被自动追加 AND tenant_id = ?，
            // 且仅作用于实体 CRUD；手写 @Select/@Update/XML SQL 不受影响。
            // 无租户上下文（登录/注册/ops/webhook/定时任务）时工厂返回 null，行为与改造前一致。
            globalConfig.setTenantColumn(TENANT_COLUMN);
            TenantManager.setTenantFactory(new ProyubiTenantFactory(tenancyProperties));
            log.info("多租户隔离已启用（mode=MULTI）：tenant_id 自动注入由 TenantManager 强制执行");
        } else {
            // 私有化单租户：不启用租户列检测，tenant_id 仍由各 Service 手动设置。
            globalConfig.setTenantColumn(null);
            log.info("多租户隔离未启用（mode=SINGLE，私有化单租户）");
        }
    }
}

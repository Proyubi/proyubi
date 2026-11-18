package ai.proyubi.common.mybatisflex.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Configuration;
import org.springframework.util.StringUtils;

import javax.sql.DataSource;
import java.lang.reflect.Method;

/**
 * 数据源配置
 * 
 * 解决 PostgreSQL prepared statement 缓存问题：
 * 在使用连接池时，PostgreSQL 服务器端的 prepared statement 可能会冲突，
 * 通过设置 prepareThreshold=0 来禁用服务器端 prepared statement
 *
 */
@Configuration
public class DataSourceConfig implements BeanPostProcessor {

    private static final Logger log = LoggerFactory.getLogger(DataSourceConfig.class);

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
        // 只处理 DataSource 类型的 bean，并使用反射来访问 HikariDataSource 的方法
        // 这样不需要直接依赖 HikariCP，因为 HikariCP 是由 Spring Boot 自动配置提供的
        if (bean instanceof DataSource) {
            try {
                // 使用反射检查是否是 HikariDataSource
                Class<?> beanClass = bean.getClass();
                if (beanClass.getName().equals("com.zaxxer.hikari.HikariDataSource")) {
                    log.info("检测到 HikariDataSource，开始配置: {}", beanName);
                    
                    // 获取 getJdbcUrl 方法
                    Method getJdbcUrlMethod = beanClass.getMethod("getJdbcUrl");
                    String url = (String) getJdbcUrlMethod.invoke(bean);
                    log.debug("原始 JDBC URL: {}", url);
                    
                    // 如果 URL 中没有 prepareThreshold 参数，则添加
                    if (StringUtils.hasText(url) && !url.contains("prepareThreshold")) {
                        String separator = url.contains("?") ? "&" : "?";
                        url = url + separator + "prepareThreshold=0";
                        
                        // 设置新的 URL
                        Method setJdbcUrlMethod = beanClass.getMethod("setJdbcUrl", String.class);
                        setJdbcUrlMethod.invoke(bean, url);
                        log.info("已添加 prepareThreshold=0 到 JDBC URL");
                    } else if (url != null && url.contains("prepareThreshold")) {
                        log.debug("JDBC URL 已包含 prepareThreshold 参数");
                    }

                    // 设置连接初始化 SQL（可选，用于设置会话参数）
                    Method getConnectionInitSqlMethod = beanClass.getMethod("getConnectionInitSql");
                    String initSql = (String) getConnectionInitSqlMethod.invoke(bean);
                    if (initSql == null || initSql.isEmpty()) {
                        Method setConnectionInitSqlMethod = beanClass.getMethod("setConnectionInitSql", String.class);
                        setConnectionInitSqlMethod.invoke(bean, "SET SESSION statement_timeout = 0");
                        log.info("已设置连接初始化 SQL: SET SESSION statement_timeout = 0");
                    } else {
                        log.debug("连接初始化 SQL 已存在: {}", initSql);
                    }
                    
                    // 记录连接池配置信息（用于调试）
                    try {
                        Method getMaximumPoolSizeMethod = beanClass.getMethod("getMaximumPoolSize");
                        Method getMinimumIdleMethod = beanClass.getMethod("getMinimumIdle");
                        Method getConnectionTimeoutMethod = beanClass.getMethod("getConnectionTimeout");
                        Method getMaxLifetimeMethod = beanClass.getMethod("getMaxLifetime");
                        Method getIdleTimeoutMethod = beanClass.getMethod("getIdleTimeout");
                        Method getLeakDetectionThresholdMethod = beanClass.getMethod("getLeakDetectionThreshold");
                        
                        int maxPoolSize = (Integer) getMaximumPoolSizeMethod.invoke(bean);
                        int minIdle = (Integer) getMinimumIdleMethod.invoke(bean);
                        long connectionTimeout = (Long) getConnectionTimeoutMethod.invoke(bean);
                        long maxLifetime = (Long) getMaxLifetimeMethod.invoke(bean);
                        long idleTimeout = (Long) getIdleTimeoutMethod.invoke(bean);
                        long leakDetectionThreshold = (Long) getLeakDetectionThresholdMethod.invoke(bean);
                        
                        log.info("HikariCP 连接池配置 - 最大连接数: {}, 最小空闲连接: {}, 连接超时: {}ms, 最大生命周期: {}ms, 空闲超时: {}ms, 泄漏检测阈值: {}ms",
                            maxPoolSize, minIdle, connectionTimeout, maxLifetime, idleTimeout, leakDetectionThreshold);
                    } catch (Exception e) {
                        log.debug("无法读取连接池配置信息: {}", e.getMessage());
                    }
                    
                    log.info("HikariDataSource 配置完成: {}", beanName);
                }
            } catch (Exception e) {
                // 如果反射失败，记录警告日志（可能不是 HikariDataSource 或方法不存在）
                log.warn("配置 HikariDataSource 失败 (bean: {}): {}", beanName, e.getMessage());
                // 这不会影响其他数据源的正常使用
            }
        }
        
        return bean;
    }
}


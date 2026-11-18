package ai.proyubi.common.satoken.config;

import cn.dev33.satoken.stp.StpInterface;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sa-Token 基础配置（MVP 版）。
 *
 * 权限接口后续会接入 ops 的角色/权限数据源。
 * 
 * 注意：从 Authorization header 读取 token 的功能通过 SaTokenHeaderFilter 实现
 */
@Configuration
public class SaTokenConfig {

    @Bean
    public StpInterface stpInterface() {
        return new SimpleStpInterface();
    }
}



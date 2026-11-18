package ai.proyubi.server;

import com.mybatisflex.core.FlexGlobalConfig;
import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = {"ai.proyubi"})
@MapperScan({
    "ai.proyubi.platform.mapper",
    "ai.proyubi.account.mapper",
    "ai.proyubi.settings.mapper",
    "ai.proyubi.pm.mapper",
    "ai.proyubi.common.mybatisflex.mapper",
    "ai.proyubi.identity.mapper",
    "ai.proyubi.identity.email"
})
public class ProyubiApplication {

    static {
        // 在类加载时立即禁用 MyBatis-Flex 的 banner
        try {
            FlexGlobalConfig.getDefaultConfig().setPrintBanner(false);
        } catch (Exception e) {
            // 忽略错误
        }
    }

    public static void main(String[] args) {
        // .env 文件会通过 DotEnvEnvironmentPostProcessor 自动加载
        SpringApplication.run(ProyubiApplication.class, args);
    }

}

package ai.proyubi.server;

import io.github.cdimascio.dotenv.Dotenv;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

import java.io.File;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * 加载 .env 文件的 EnvironmentPostProcessor。
 *
 * 加载顺序与 Maven Profile / Spring Profile 联动：
 *   1. .env.local                 — 本地强覆盖（仅本机，git 忽略）
 *   2. .env.&lt;active-profile&gt; — 跟随 spring.profiles.active（dev/prod）
 *   3. .env                       — 兜底
 *
 * 之所以让 order 排在 ConfigDataEnvironmentPostProcessor 之后，是为了能读到
 * application.yml 里被 Maven 过滤注入的 spring.profiles.active 值。
 */
public class DotEnvEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    @Override
    public int getOrder() {
        // 必须在 ConfigData 之后，否则读不到 application.yml 里的 spring.profiles.active
        return ConfigDataEnvironmentPostProcessor.ORDER + 1;
    }

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        try {
            // 获取当前工作目录
            String currentDir = System.getProperty("user.dir");
            File serverDir;
            File projectRoot;

            // 确定 server 目录和项目根目录（proyubi-server 也以 "server" 结尾，先判断它）
            if (currentDir.endsWith("proyubi-server")) {
                serverDir = new File(currentDir).getParentFile();
                projectRoot = serverDir.getParentFile();
            } else if (currentDir.endsWith("server")) {
                serverDir = new File(currentDir);
                projectRoot = serverDir.getParentFile();
            } else {
                serverDir = new File(currentDir, "server");
                projectRoot = new File(currentDir);
            }

            // 优先级：.env.<active-profile> > .env.local > .env
            // 这样 IDEA Maven Profile 切到 prod 时，会读 .env.prod 里的真实 prod DB 连接，
            // 而不会被本地 .env.local（dev 覆盖）误命中。
            Set<String> envNames = new LinkedHashSet<>();
            for (String profile : environment.getActiveProfiles()) {
                envNames.add(".env." + profile);
            }
            envNames.add(".env.local");
            envNames.add(".env");

            Dotenv dotenv = null;
            File[] searchDirs = {serverDir, projectRoot};

            for (File searchDir : searchDirs) {
                for (String envName : envNames) {
                    File candidateFile = new File(searchDir, envName);
                    if (candidateFile.exists()) {
                        dotenv = Dotenv.configure()
                            .directory(searchDir.getAbsolutePath())
                            .filename(envName)
                            .ignoreIfMissing()
                            .load();
                        break;
                    }
                }
                if (dotenv != null) {
                    break;
                }
            }
            
            if (dotenv != null) {
                // 将 .env 文件中的变量添加到 Spring Environment
                Map<String, Object> properties = new HashMap<>();
                for (var entry : dotenv.entries()) {
                    // 如果环境变量中不存在，则添加
                    if (!environment.containsProperty(entry.getKey())) {
                        properties.put(entry.getKey(), entry.getValue());
                    }
                }
                
                if (!properties.isEmpty()) {
                    environment.getPropertySources().addFirst(
                        new MapPropertySource("dotenv", properties)
                    );
                }
            }
        } catch (Exception e) {
            // 如果加载失败，不影响应用启动
            System.err.println("警告：无法加载 .env 文件: " + e.getMessage());
        }
    }
}


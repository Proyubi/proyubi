package ai.proyubi.common.web.config;

import com.fasterxml.jackson.core.StreamReadConstraints;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * リクエスト JSON の 1 文字列あたりの上限を広げる。
 * Jackson 既定（2000 万文字）では、PM デザインボードの .pen 原文（上限 32MiB → base64 で約 4300 万文字）を
 * 受け取れず「请求体解析失败」になる。
 * PM モックアップの MCP 公開（zipBase64、zip 上限 50MB → 約 7000 万文字）もこの上限に収まるようにしてある。全体の大きさは各 API 側（proyubi.pm.design.max-pen-bytes など）で制限する。
 *
 */
@Configuration
public class JacksonConfig {

    private static final int MAX_STRING_LENGTH = 80 * 1024 * 1024;

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer largeStringConstraints() {
        return builder -> builder.postConfigurer(om -> om.getFactory().setStreamReadConstraints(
            StreamReadConstraints.builder().maxStringLength(MAX_STRING_LENGTH).build()));
    }
}

package ai.proyubi.common.web.config;

import ai.proyubi.common.web.core.I18nLocaleResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.LocaleResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web MVC 配置
 *
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    /**
     * 注册多语言 LocaleResolver
     * 注意：LocaleInterceptor 在 SaTokenWebMvcConfig 中注册（order=-1），此处不重复注册
     */
    @Bean
    public LocaleResolver localeResolver() {
        return new I18nLocaleResolver();
    }
}

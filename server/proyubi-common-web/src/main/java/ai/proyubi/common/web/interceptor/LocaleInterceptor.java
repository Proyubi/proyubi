package ai.proyubi.common.web.interceptor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.LocaleResolver;
import org.springframework.web.servlet.support.RequestContextUtils;

import java.util.Locale;

/**
 * Locale 拦截器
 * 确保 Locale 被正确设置到 LocaleContextHolder
 *
 */
@Component
public class LocaleInterceptor implements HandlerInterceptor {

    private static final Logger log = LoggerFactory.getLogger(LocaleInterceptor.class);

    @Override
    public boolean preHandle(
        @NonNull HttpServletRequest request,
        @NonNull HttpServletResponse response,
        @NonNull Object handler
    ) {
        try {
            // 从 RequestContextUtils 获取 LocaleResolver（Spring 会自动注入）
            LocaleResolver localeResolver = RequestContextUtils.getLocaleResolver(request);
            if (localeResolver == null) {
                log.warn("无法获取 LocaleResolver，使用默认 Locale");
                org.springframework.context.i18n.LocaleContextHolder.setLocale(Locale.ENGLISH);
                return true;
            }
            
            // 解析 Locale
            Locale locale = localeResolver.resolveLocale(request);
            
            // 设置到 LocaleContextHolder（这样 TranslationService 才能获取到）
            org.springframework.context.i18n.LocaleContextHolder.setLocale(locale);
            
            String acceptLanguage = request.getHeader("Accept-Language");
            log.info("LocaleInterceptor: 设置 Locale={} (language={}, country={}) 从 Accept-Language: {}", 
                locale, locale.getLanguage(), locale.getCountry(), acceptLanguage);
        } catch (Exception e) {
            log.warn("设置 Locale 失败: {}", e.getMessage());
            // 设置默认 Locale
            org.springframework.context.i18n.LocaleContextHolder.setLocale(Locale.ENGLISH);
        }
        
        return true;
    }

    @Override
    public void afterCompletion(
        @NonNull HttpServletRequest request,
        @NonNull HttpServletResponse response,
        @NonNull Object handler,
        Exception ex
    ) {
        // 清理 LocaleContextHolder（避免线程池复用导致的问题）
        org.springframework.context.i18n.LocaleContextHolder.resetLocaleContext();
    }
}


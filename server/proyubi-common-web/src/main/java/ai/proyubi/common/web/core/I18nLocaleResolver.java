package ai.proyubi.common.web.core;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.lang.Nullable;
import org.springframework.util.StringUtils;
import org.springframework.web.servlet.LocaleResolver;

import java.util.Locale;

/**
 * 多语言 LocaleResolver
 * 优先级：X-Lang 自定义头 > lang 查询参数 > Accept-Language > 默认中文
 *
 */
public class I18nLocaleResolver implements LocaleResolver {

    private static final Logger log = LoggerFactory.getLogger(I18nLocaleResolver.class);
    private static final String X_LANG_HEADER = "X-Lang";
    private static final String LANG_PARAM = "lang";
    private static final String ACCEPT_LANGUAGE_HEADER = "Accept-Language";
    private static final Locale DEFAULT_LOCALE = new Locale("zh", "CN");

    @Override
    public Locale resolveLocale(HttpServletRequest request) {
        // 1. 优先从 X-Lang 自定义头获取（由前端语言切换器设置，最可靠）
        String xLang = request.getHeader(X_LANG_HEADER);
        if (StringUtils.hasText(xLang)) {
            Locale locale = parseLocale(xLang);
            log.info("I18nLocaleResolver: 从 X-Lang 头解析 Locale: {} -> {} (language={}, country={})",
                xLang, locale, locale.getLanguage(), locale.getCountry());
            return locale;
        }

        // 2. 从查询参数获取（如 ?lang=zh_CN）
        String langParam = request.getParameter(LANG_PARAM);
        if (StringUtils.hasText(langParam)) {
            Locale locale = parseLocale(langParam);
            log.info("I18nLocaleResolver: 从查询参数解析 Locale: {} -> {}", langParam, locale);
            return locale;
        }

        // 3. 从 Accept-Language 请求头解析
        String acceptLanguage = request.getHeader(ACCEPT_LANGUAGE_HEADER);
        if (StringUtils.hasText(acceptLanguage)) {
            Locale locale = parseAcceptLanguage(acceptLanguage);
            if (locale != null) {
                log.debug("I18nLocaleResolver: 从 Accept-Language 解析 Locale: {} -> {}", acceptLanguage, locale);
                return locale;
            }
        }

        // 4. 默认中文
        log.debug("I18nLocaleResolver: 使用默认 Locale: {}", DEFAULT_LOCALE);
        return DEFAULT_LOCALE;
    }

    @Override
    public void setLocale(HttpServletRequest request, HttpServletResponse response, @Nullable Locale locale) {
        // 不支持设置，只读解析
    }

    /**
     * 解析语言字符串（支持 zh_CN, zh-CN, zh 等格式）
     */
    private Locale parseLocale(String lang) {
        if (!StringUtils.hasText(lang)) {
            return DEFAULT_LOCALE;
        }

        String normalized = lang.replace("-", "_");
        String[] parts = normalized.split("_");

        if (parts.length >= 2) {
            return new Locale(parts[0], parts[1]);
        } else if (parts.length == 1) {
            return new Locale(parts[0]);
        }

        return DEFAULT_LOCALE;
    }

    /**
     * 解析 Accept-Language 请求头（取第一个语言）
     */
    @Nullable
    private Locale parseAcceptLanguage(String acceptLanguage) {
        if (!StringUtils.hasText(acceptLanguage)) {
            return null;
        }

        String[] languages = acceptLanguage.split(",");
        if (languages.length == 0) {
            return null;
        }

        String firstLang = languages[0].trim();
        int semicolonIndex = firstLang.indexOf(';');
        if (semicolonIndex > 0) {
            firstLang = firstLang.substring(0, semicolonIndex).trim();
        }

        return parseLocale(firstLang);
    }
}

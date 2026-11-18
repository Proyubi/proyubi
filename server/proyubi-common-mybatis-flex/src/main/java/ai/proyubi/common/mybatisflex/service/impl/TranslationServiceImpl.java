package ai.proyubi.common.mybatisflex.service.impl;

import ai.proyubi.common.mybatisflex.mapper.SysI18nKeyMapper;
import ai.proyubi.common.mybatisflex.service.TranslationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 翻译服务实现
 *
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TranslationServiceImpl implements TranslationService {

    private final SysI18nKeyMapper i18nKeyMapper;

    /**
     * Locale 标准化映射，将各种 Locale 表示统一为数据库中使用的 lang_code。
     * 数据库中菜单翻译使用的 lang_code: zh_CN, en, ja
     */
    private static final Map<String, String> LOCALE_NORMALIZATION = Map.ofEntries(
        Map.entry("zh", "zh_CN"),
        Map.entry("zh_CN", "zh_CN"),
        Map.entry("en", "en"),
        Map.entry("en_US", "en"),
        Map.entry("ja", "ja"),
        Map.entry("ja_JP", "ja")
    );

    /**
     * 将 Locale 转换为语言代码（如 zh_CN, en, ja）
     * 统一映射为数据库中存储的 lang_code 格式
     */
    private String localeToLangCode(Locale locale) {
        if (locale == null) {
            log.warn("localeToLangCode: 输入 Locale 为 null，返回默认语言 'en'");
            return "en"; // 默认英文
        }

        String language = locale.getLanguage();
        String country = locale.getCountry();
        String rawCode = (country != null && !country.isEmpty()) ? language + "_" + country : language;
        String langCode = LOCALE_NORMALIZATION.getOrDefault(rawCode, rawCode);

        log.debug("localeToLangCode: Locale={} (language={}, country={}) 转换为语言代码 {}", locale, language, country, langCode);
        return langCode;
    }

    @Override
    public String translate(String i18nKey, String defaultValue) {
        if (i18nKey == null || i18nKey.isEmpty()) {
            return defaultValue;
        }

        String langCode = getCurrentLangCode();
        return translate(i18nKey, langCode, defaultValue);
    }

    @Override
    public String translate(String i18nKey, String langCode, String defaultValue) {
        if (i18nKey == null || i18nKey.isEmpty()) {
            return defaultValue;
        }

        try {
            String value = i18nKeyMapper.selectValueByKey(i18nKey, langCode);
            if (value != null && !value.isEmpty()) {
                return value;
            }

            // 如果找不到翻译，尝试使用默认语言（en）
            if (!"en".equals(langCode) && !"en_US".equals(langCode)) {
                value = i18nKeyMapper.selectValueByKey(i18nKey, "en");
                if (value != null && !value.isEmpty()) {
                    return value;
                }
            }

            // 如果还是找不到，返回默认值或 i18n_key 本身
            return defaultValue != null ? defaultValue : i18nKey;
        } catch (Exception e) {
            log.warn("翻译失败: i18n_key={}, lang_code={}, error={}", i18nKey, langCode, e.getMessage());
            return defaultValue != null ? defaultValue : i18nKey;
        }
    }

    @Override
    public Map<String, String> translateBatch(List<String> i18nKeys) {
        String langCode = getCurrentLangCode();
        return translateBatch(i18nKeys, langCode);
    }

    @Override
    public Map<String, String> translateBatch(List<String> i18nKeys, String langCode) {
        Map<String, String> result = new HashMap<>();

        if (i18nKeys == null || i18nKeys.isEmpty()) {
            return result;
        }

        try {
            log.info("批量翻译查询: langCode={}, keys数量={}, 前3个keys={}", langCode, i18nKeys.size(), i18nKeys.subList(0, Math.min(3, i18nKeys.size())));
            // 批量查询（返回 List<Map<String, Object>>）
            List<Map<String, Object>> translationList = i18nKeyMapper.selectBatchByKeys(i18nKeys, langCode);
            log.info("批量翻译返回 {} 条结果 (查询 langCode={})", translationList.size(), langCode);

            // 诊断日志：输出第一行的 Map keys，确认是 snake_case 还是 camelCase
            if (!translationList.isEmpty()) {
                log.info("翻译结果 Map keys: {}", translationList.get(0).keySet());
            }

            // 将 List<Map> 转换为 Map<String, String>
            // 兼容 snake_case (i18n_key) 和 camelCase (i18nKey) 两种 Map key 格式
            // （MyBatis 的 map-underscore-to-camel-case 配置可能影响 Map 返回值的 key 格式）
            Map<String, String> translations = new HashMap<>();
            for (Map<String, Object> row : translationList) {
                String i18nKey = getMapStringValue(row, "i18n_key", "i18nKey");
                String i18nValue = getMapStringValue(row, "i18n_value", "i18nValue");
                if (i18nKey != null && i18nValue != null) {
                    translations.put(i18nKey, i18nValue);
                    log.debug("翻译映射: {} -> {}", i18nKey, i18nValue);
                }
            }

            if (translations.isEmpty() && !i18nKeys.isEmpty()) {
                log.error("翻译查询返回空结果！langCode={}, 前3个keys={}。请检查：1) 数据库中是否有对应的翻译数据 2) lang_code 是否匹配",
                    langCode, i18nKeys.subList(0, Math.min(3, i18nKeys.size())));
            } else {
                log.info("翻译查询成功，返回的翻译结果数量: {}", translations.size());
            }
            result.putAll(translations);

            // 如果当前语言不是英文，且某些 key 找不到翻译，尝试用英文
            if (!"en".equals(langCode) && !"en_US".equals(langCode)) {
                List<String> missingKeys = i18nKeys.stream()
                    .filter(key -> !result.containsKey(key))
                    .toList();

                if (!missingKeys.isEmpty()) {
                    List<Map<String, Object>> enTranslationList = i18nKeyMapper.selectBatchByKeys(missingKeys, "en");
                    Map<String, String> enTranslations = new HashMap<>();
                    for (Map<String, Object> row : enTranslationList) {
                        String i18nKey = getMapStringValue(row, "i18n_key", "i18nKey");
                        String i18nValue = getMapStringValue(row, "i18n_value", "i18nValue");
                        if (i18nKey != null && i18nValue != null) {
                            enTranslations.put(i18nKey, i18nValue);
                        }
                    }
                    result.putAll(enTranslations);
                }
            }

            // 对于仍然找不到的 key，使用 key 本身作为值
            for (String key : i18nKeys) {
                result.putIfAbsent(key, key);
            }
        } catch (Exception e) {
            log.warn("批量翻译失败: lang_code={}, error={}", langCode, e.getMessage(), e);
            // 失败时，使用 key 本身作为值
            for (String key : i18nKeys) {
                result.put(key, key);
            }
        }

        return result;
    }

    /**
     * 从 Map 中获取 String 值，兼容 camelCase 和 snake_case 两种 key 格式。
     * 优先尝试 camelCase（map-underscore-to-camel-case=true 时 MyBatis 使用此格式），
     * 其次尝试 snake_case（标准 MyBatis Map 返回格式）。
     */
    private String getMapStringValue(Map<String, Object> row, String snakeKey, String camelKey) {
        Object val = row.get(camelKey);
        if (val == null) {
            val = row.get(snakeKey);
        }
        return val != null ? val.toString() : null;
    }

    @Override
    public String getCurrentLangCode() {
        Locale locale = LocaleContextHolder.getLocale();
        String langCode = localeToLangCode(locale);
        log.info("getCurrentLangCode: Locale={} (language={}, country={}) → langCode={}", locale, locale.getLanguage(), locale.getCountry(), langCode);
        return langCode;
    }

    @Override
    public void saveTranslations(String i18nKey, Map<String, String> translations, String resourceType) {
        if (i18nKey == null || translations == null || translations.isEmpty()) {
            return;
        }
        for (Map.Entry<String, String> entry : translations.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null && !entry.getValue().isEmpty()) {
                i18nKeyMapper.upsertTranslation(i18nKey, entry.getKey(), entry.getValue(), resourceType);
            }
        }
    }

    @Override
    public Map<String, String> getTranslationsByKey(String i18nKey) {
        Map<String, String> result = new HashMap<>();
        if (i18nKey == null || i18nKey.isEmpty()) {
            return result;
        }
        List<Map<String, Object>> rows = i18nKeyMapper.selectAllLangsByKey(i18nKey);
        for (Map<String, Object> row : rows) {
            String langCode = getMapStringValue(row, "lang_code", "langCode");
            String i18nValue = getMapStringValue(row, "i18n_value", "i18nValue");
            if (langCode != null && i18nValue != null) {
                result.put(langCode, i18nValue);
            }
        }
        return result;
    }
}


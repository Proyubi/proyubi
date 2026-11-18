package ai.proyubi.common.mybatisflex.service;

import java.util.List;
import java.util.Map;

/**
 * 翻译服务接口
 *
 */
public interface TranslationService {

    /**
     * 根据 i18n_key 和当前语言获取翻译
     *
     * @param i18nKey      翻译键
     * @param defaultValue 默认值（如果找不到翻译则返回此值）
     * @return 翻译值
     */
    String translate(String i18nKey, String defaultValue);

    /**
     * 根据 i18n_key 和指定语言获取翻译
     *
     * @param i18nKey      翻译键
     * @param langCode     语言代码（zh_CN/en/ja）
     * @param defaultValue 默认值
     * @return 翻译值
     */
    String translate(String i18nKey, String langCode, String defaultValue);

    /**
     * 批量翻译
     *
     * @param i18nKeys 翻译键列表
     * @return Map<i18n_key, i18n_value>，如果某个 key 找不到翻译，则 value 为 null
     */
    Map<String, String> translateBatch(List<String> i18nKeys);

    /**
     * 批量翻译（指定语言）
     *
     * @param i18nKeys 翻译键列表
     * @param langCode 语言代码
     * @return Map<i18n_key, i18n_value>
     */
    Map<String, String> translateBatch(List<String> i18nKeys, String langCode);

    /**
     * 获取当前语言代码
     *
     * @return 语言代码（zh_CN/en/ja）
     */
    String getCurrentLangCode();

    /**
     * 批量保存翻译（upsert）
     *
     * @param i18nKey      翻译键
     * @param translations Map<langCode, i18nValue>
     * @param resourceType 资源类型（如 "menu"）
     */
    void saveTranslations(String i18nKey, Map<String, String> translations, String resourceType);

    /**
     * 获取指定 key 的所有语言翻译
     *
     * @param i18nKey 翻译键
     * @return Map<langCode, i18nValue>
     */
    Map<String, String> getTranslationsByKey(String i18nKey);
}


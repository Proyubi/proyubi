package ai.proyubi.common.mybatisflex.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.common.mybatisflex.domain.SysI18nKey;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

/**
 * 多语言翻译键值对 Mapper
 *
 */
@Mapper
public interface SysI18nKeyMapper extends BaseMapper<SysI18nKey> {

    /**
     * 批量查询翻译（根据 i18n_key 列表和 lang_code）
     * 返回 List<Map>，每个 Map 包含 i18n_key 和 i18n_value
     * 注意：MyBatis 的 @Select 返回 Map 时，如果有多行会报错，所以返回 List
     */
    @Select("""
        <script>
        SELECT i18n_key, i18n_value
        FROM platform_sys_i18n_key
        WHERE lang_code = #{langCode}
          AND i18n_key IN
          <foreach collection="i18nKeys" item="key" open="(" separator="," close=")">
            #{key}
          </foreach>
          AND deleted_at IS NULL
        ORDER BY i18n_key
        </script>
        """)
    List<Map<String, Object>> selectBatchByKeys(@Param("i18nKeys") List<String> i18nKeys, @Param("langCode") String langCode);

    /**
     * 查询单个翻译
     */
    @Select("""
        SELECT i18n_value
        FROM platform_sys_i18n_key
        WHERE i18n_key = #{i18nKey}
          AND lang_code = #{langCode}
          AND deleted_at IS NULL
        LIMIT 1
        """)
    String selectValueByKey(@Param("i18nKey") String i18nKey, @Param("langCode") String langCode);

    /**
     * Upsert 单条翻译（INSERT ... ON CONFLICT DO UPDATE）
     */
    @Insert("""
        INSERT INTO platform_sys_i18n_key (id, i18n_key, lang_code, i18n_value, resource_type, created_at, updated_at)
        VALUES (gen_random_uuid(), #{i18nKey}, #{langCode}, #{i18nValue}, #{resourceType}, now(), now())
        ON CONFLICT (i18n_key, lang_code) WHERE deleted_at IS NULL
        DO UPDATE SET i18n_value = EXCLUDED.i18n_value, updated_at = now()
        """)
    void upsertTranslation(@Param("i18nKey") String i18nKey,
                           @Param("langCode") String langCode,
                           @Param("i18nValue") String i18nValue,
                           @Param("resourceType") String resourceType);

    /**
     * 查询指定 i18n_key 的所有语言翻译
     */
    @Select("""
        SELECT lang_code, i18n_value
        FROM platform_sys_i18n_key
        WHERE i18n_key = #{i18nKey}
          AND deleted_at IS NULL
        ORDER BY lang_code
        """)
    List<Map<String, Object>> selectAllLangsByKey(@Param("i18nKey") String i18nKey);
}


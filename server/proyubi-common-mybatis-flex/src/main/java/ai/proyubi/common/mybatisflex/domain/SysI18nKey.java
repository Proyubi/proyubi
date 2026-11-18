package ai.proyubi.common.mybatisflex.domain;

import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 多语言翻译键值对实体
 *
 */
@Data
@Table("platform_sys_i18n_key")
public class SysI18nKey {

    @Id
    private UUID id;

    /**
     * 翻译键（如 menu.user_management、dict.wms_sku_status.normal）
     */
    private String i18nKey;

    /**
     * 语言代码（zh_CN/en/ja）
     */
    private String langCode;

    /**
     * 翻译值
     */
    private String i18nValue;

    /**
     * 资源类型（menu/dict/config等，可选）
     */
    private String resourceType;

    /**
     * 关联的资源ID（可选，如 menu.id）
     */
    private UUID resourceId;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}


package ai.proyubi.platform.domain;

import lombok.Data;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 菜单 VO（返回给前端，已翻译）
 *
 */
@Data
public class MenuVO {

    private UUID id;

    /**
     * 菜单名称 i18n_key（原始值，用于维护）
     */
    private String menuNameKey;

    /**
     * 菜单名称（已翻译，用于显示）
     */
    private String menuName;

    private UUID parentId;

    private Integer orderNum;

    private String path;

    private String component;

    private String componentName;

    private String queryParam;

    private Boolean isFrame;

    private Boolean isCache;

    private String menuType;

    private Boolean visible;

    private Boolean status;

    private String perms;

    private String icon;

    private String remark;

    private UUID appId;

    private String audience;

    private String permCode;

    /**
     * 所有语言的翻译（仅详情接口返回）
     * key: langCode (如 zh_CN, en)
     * value: 翻译值
     */
    private Map<String, String> translations;

    /**
     * 子菜单
     */
    private List<MenuVO> children;
}


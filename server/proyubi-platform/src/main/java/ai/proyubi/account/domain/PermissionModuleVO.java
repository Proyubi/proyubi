package ai.proyubi.account.domain;

import lombok.Data;

import java.util.List;

/**
 * 可分配权限模块 VO（按能力分组）
 */
@Data
public class PermissionModuleVO {
    private String module;       // 能力代码，如 warehouse
    private String moduleLabel;  // 能力名称
    private List<PermissionGroupVO> groups;

    @Data
    public static class PermissionGroupVO {
        private String group;        // 资源组，如 product, transaction
        private String groupLabel;   // 资源组名称（由前端 i18n 映射）
        private List<PermissionItemVO> permissions;
    }

    @Data
    public static class PermissionItemVO {
        private String code;   // 权限代码，如 app:product:list
        private String name;   // 权限名称
        private String type;   // menu / button
        private String action; // 动作，如 list, add, edit, delete
    }
}

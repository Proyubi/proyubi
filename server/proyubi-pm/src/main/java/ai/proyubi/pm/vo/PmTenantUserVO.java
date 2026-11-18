package ai.proyubi.pm.vo;

import lombok.Data;

import java.util.UUID;

/**
 * 租户用户 VO（PM 成员绑定用）。
 * 读 platform_tenant_user，PM 成员从这里"拉人进来"，与 WMS 共用同一套账户。
 *
 */
@Data
public class PmTenantUserVO {

    /** platform_tenant_user.id */
    private UUID id;

    /** 显示名 */
    private String displayName;

    /** 租户内角色（owner / member） */
    private String role;

    /** 是否启用 */
    private Boolean enabled;
}

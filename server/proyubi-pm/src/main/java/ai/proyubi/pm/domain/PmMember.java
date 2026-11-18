package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 团队成员实体（PM）
 *
 */
@Data
@Table("pm_member")
public class PmMember {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 绑定的租户用户（platform_tenant_user.id）；null=未绑定的 legacy/外部成员 */
    private UUID userId;

    /** 成员姓名（默认取租户用户 display_name，可覆盖为甘特显示名） */
    private String name;

    /** 头像底色，同时用于甘特图按人着色 */
    private String color;

    /** 角色（PM / 开发 / 测试 等） */
    private String role;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

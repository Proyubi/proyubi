package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 资料实体（PM）。指向外部网盘（Google ドライブ / SharePoint / Box…）上的文件/文件夹，
 * PM 只存链接 + 对应关系（顧客 / 案件 / タスク），不复制文件本体。
 * provider / kind / externalId 由服务端按 url 判定（{@link ai.proyubi.pm.service.PmDocUrlParser}），前端不可信。
 * 设计：doc/design/pm-drive-docs.md
 *
 */
@Data
@Table("pm_doc")
public class PmDoc {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属客户（pm_customer.id）；登记到案件时由服务端从案件取 */
    private UUID customerId;

    /** 所属案件（pm_project.id）；null = 顧客共通 */
    private UUID projectId;

    /** 是否根文件夹（顧客ルート / 案件フォルダ）；同 scope 未删除至多一个 */
    private Boolean isRoot;

    /** 链接 URL（http/https） */
    private String url;

    /** google / microsoft / box / other */
    private String provider;

    /** gdoc / gsheet / gslide / gfile / gfolder / ms / box / link */
    private String kind;

    /** 从 URL 解析出的 Google 文件/文件夹 id；其余为 null */
    private String externalId;

    /** 显示名（可空；空则前端用 URL 推断） */
    private String title;

    /** Google Picker 返回的 mimeType（贴 URL 登记时为 null）；前端据此判定文件类型图标 */
    private String mimeType;

    /** 添加人租户用户（platform_tenant_user.id） */
    private UUID createdBy;

    /** 添加人显示名快照（写入时定格） */
    private String createdByName;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

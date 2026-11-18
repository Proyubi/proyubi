package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 资料 ↔ 任务 对应关系（PM，多对多）。任务必须与资料同案件（服务端校验）。
 *
 */
@Data
@Table("pm_doc_task")
public class PmDocTask {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 资料（pm_doc.id） */
    private UUID docId;

    /** 任务（pm_task.id） */
    private UUID taskId;

    /** 建立对应关系的租户用户（platform_tenant_user.id）；仅作审计 */
    private UUID createdBy;

    private LocalDateTime createdAt;

    private LocalDateTime deletedAt;
}

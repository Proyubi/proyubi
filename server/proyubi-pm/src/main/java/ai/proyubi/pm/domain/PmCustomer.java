package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 客户/产品实体（PM）。例：東邦銀行
 *
 */
@Data
@Table("pm_customer")
public class PmCustomer {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 所属团队ID（多团队隔离的根维度；项目从客户继承） */
    private UUID teamId;

    /** 客户名 */
    private String name;

    /** 简称 */
    private String shortName;

    /** 有效/无效（无效=归档，不在选择器中默认可选；默认 true） */
    private Boolean active;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

package ai.proyubi.settings.domain;

import ai.proyubi.common.mybatisflex.typehandler.PostgreSqlJsonbTypeHandler;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 租户业务配置实体（Core Domain）
 * 一个租户一行，settings 为 JSON 格式的配置
 *
 */
@Data
@Table("wms_tenant_settings")
public class TenantSettings {

    @Id
    private UUID id;

    /**
     * 租户ID（仅用于数据隔离，Core Domain 不关心租户业务）
     */
    @Column(tenantId = false)
    private UUID tenantId;

    /**
     * 业务配置（JSON格式）
     */
    @Column(typeHandler = PostgreSqlJsonbTypeHandler.class)
    private String settings;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}

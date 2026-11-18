package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * PM 租户级设置实体（单行 / 租户）。
 * <p>
 * 目前仅含 {@code hoursPerWorkday}＝1営業日=何時間（工期 ↔ 時間の換算単位）。
 * 既定 8（未设置时由 {@link ai.proyubi.pm.service.PmSettingService} 用默认值），7.5 等小数可。
 * 该值只改变「日 ↔ 時間」的换算解释，不改动既存任务的 days/hours 存储数据。
 *
 */
@Data
@Table("pm_setting")
public class PmSetting {

    @Id
    private UUID id;

    /** 租户ID（数据隔离；每租户至多一行） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 1営業日=何時間（工期↔時間の換算単位）。既定 8.0、7.5 等の小数可。 */
    private Double hoursPerWorkday;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}

package ai.proyubi.pm.domain;

import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 节假日（红日子 / 祝日）实体（PM）。
 * 租户级、跨项目共享一套日历；工期按工作日计算时排除「周末 + 本表内日期」。
 * national/振替休日/国民の休日 由 holidays-jp 定时同步（source=holidays_jp），
 * is_manual=true 的人工行定时同步永不覆盖/删除。首版仅日本（region 默认 JP）。
 *
 */
@Data
@Table("pm_holiday")
public class PmHoliday {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 节假日日期（振替休日/国民の休日各占一行） */
    @Column("holiday_date")
    private LocalDate holidayDate;

    /** 名称（祝日名，日文） */
    private String name;

    /** 区域：首版仅 JP（预留多区域） */
    private String region;

    /** 来源：holidays_jp / cabinet / manual */
    private String source;

    /** true=人工维护，定时同步不覆盖/不删除 */
    private Boolean isManual;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

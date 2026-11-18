package ai.proyubi.pm.scheduler;

import ai.proyubi.pm.service.PmHolidayService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 节假日（祝日）定时同步：每周一 JST 05:00 从 holidays-jp 拉取并同步到各租户。
 * <p>
 * 祝日变动很少（每年 2 月内閣府公布次年春分/秋分），每周一次足够；人工「立即同步」按钮兜底。
 * {@code @EnableScheduling} 已由 AI 模块全局开启（同一 Spring 上下文），本 {@code @Scheduled} 即生效。
 * 拉取失败仅记日志、不清表，保留上次同步结果。
 *
 */
@Slf4j
@Component
public class PmHolidaySyncJob {

    private final PmHolidayService holidayService;

    public PmHolidaySyncJob(PmHolidayService holidayService) {
        this.holidayService = holidayService;
    }

    @Scheduled(cron = "0 0 5 * * MON", zone = "Asia/Tokyo")
    public void run() {
        try {
            holidayService.syncAllTenants();
        } catch (Exception e) {
            log.error("PmHolidaySyncJob 失败（保留上次同步结果）：{}", e.getMessage(), e);
        }
    }
}

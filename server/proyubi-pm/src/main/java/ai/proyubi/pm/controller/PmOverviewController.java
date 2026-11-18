package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmOverviewService;
import ai.proyubi.pm.vo.PmCalendarVO;
import ai.proyubi.pm.vo.PmOverviewVO;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.UUID;

/**
 * PM 俯瞰页聚合Controller。
 *
 */
@RestController
@RequestMapping("/app/pm")
@Validated
public class PmOverviewController {

    private final PmOverviewService overviewService;

    public PmOverviewController(PmOverviewService overviewService) {
        this.overviewService = overviewService;
    }

    /**
     * 俯瞰聚合。
     *
     * @param scope "all"=全社俯瞰（默认）；"me"=仅本人担当
     */
    @GetMapping("/overview")
    public R<PmOverviewVO> overview(@RequestParam(required = false, defaultValue = "all") String scope) {
        return R.ok(overviewService.overview(getTenantId(), TenantContext.getUserId(), scope));
    }

    /**
     * 日历视图：区间内全部已排期叶子任务（带风险种别）。
     *
     * @param from  区间起 YYYY-MM-DD（含）
     * @param to    区间止 YYYY-MM-DD（含）
     * @param scope "all"=全员（默认）；"me"=仅本人担当
     */
    @GetMapping("/calendar")
    public R<PmCalendarVO> calendar(
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
        @RequestParam(required = false, defaultValue = "all") String scope) {
        return R.ok(overviewService.calendar(getTenantId(), TenantContext.getUserId(), scope, from, to));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }
}

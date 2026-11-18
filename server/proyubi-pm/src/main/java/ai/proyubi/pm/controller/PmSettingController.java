package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmSetting;
import ai.proyubi.pm.service.PmSettingService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * PM 租户级设置 Controller。租户级，修改对整个团队的工期口径生效（owner 限定）。
 * 目前仅「1営業日=何時間」（工期 ↔ 時間の換算単位）。
 *
 */
@RestController
@RequestMapping("/app/pm/settings")
@Validated
public class PmSettingController {

    private final PmSettingService settingService;

    public PmSettingController(PmSettingService settingService) {
        this.settingService = settingService;
    }

    /** 当前租户的工数设置（含默认回退）。 */
    @GetMapping
    public R<SettingVO> get() {
        return R.ok(new SettingVO(settingService.getHoursPerWorkday(getTenantId())));
    }

    /** 更新「1営業日=何時間」（owner 限定；范围 [1,24]）。 */
    @PutMapping
    public R<SettingVO> update(@RequestBody @Valid UpdateReq req) {
        PmSetting s = settingService.updateHoursPerWorkday(getTenantId(), req.hoursPerWorkday());
        return R.ok(new SettingVO(s.getHoursPerWorkday()));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /** 工数设置视图（不外泄 id/时间戳）。 */
    public record SettingVO(Double hoursPerWorkday) {
    }

    /** 更新请求：1営業日=何時間，范围 [1,24]（小数可，如 7.5）。 */
    public record UpdateReq(
        @NotNull @DecimalMin("1") @DecimalMax("24") Double hoursPerWorkday
    ) {
    }
}

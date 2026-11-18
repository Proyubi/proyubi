package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmEnvironmentService;
import ai.proyubi.pm.vo.PmEnvironmentVO;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 品質管理 Controller：環境マスタ（バグ票の動作環境）。ルートは {@code /app/pm/**}。
 * 製品(pm_customer)配下のマスタ。可視性は Service が customer 経由で担保。
 *
 */
@RestController
@RequestMapping("/app/pm")
public class PmEnvironmentController {

    private final PmEnvironmentService environmentService;

    public PmEnvironmentController(PmEnvironmentService environmentService) {
        this.environmentService = environmentService;
    }

    @GetMapping("/customers/{customerId}/environments")
    public R<List<PmEnvironmentVO>> list(@PathVariable UUID customerId) {
        return R.ok(environmentService.list(getTenantId(), customerId));
    }

    @PostMapping("/customers/{customerId}/environments")
    public R<PmEnvironmentVO> create(@PathVariable UUID customerId, @RequestBody EnvReq req) {
        return R.ok(environmentService.create(getTenantId(), customerId, req.name(), req.browser(), req.url()));
    }

    @PatchMapping("/environments/{id}")
    public R<PmEnvironmentVO> update(@PathVariable UUID id, @RequestBody EnvReq req) {
        return R.ok(environmentService.update(id, getTenantId(), req.name(), req.browser(), req.url(), req.sortOrder()));
    }

    @DeleteMapping("/environments/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        environmentService.delete(id, getTenantId());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    public record EnvReq(String name, String browser, String url, Integer sortOrder) {}
}

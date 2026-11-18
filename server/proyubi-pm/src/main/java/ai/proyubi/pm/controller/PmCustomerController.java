package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmCustomer;
import ai.proyubi.pm.service.PmCustomerService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 客户/产品Controller（PM）
 *
 */
@RestController
@RequestMapping("/app/pm/customers")
@Validated
public class PmCustomerController {

    private final PmCustomerService customerService;

    public PmCustomerController(PmCustomerService customerService) {
        this.customerService = customerService;
    }

    @GetMapping
    public R<List<PmCustomer>> list() {
        return R.ok(customerService.list(getTenantId()));
    }

    @PostMapping
    public R<PmCustomer> create(@RequestBody @Valid CustomerReq req) {
        return R.ok(customerService.create(getTenantId(), req.name(), req.shortName(), req.teamId(), req.active()));
    }

    @PutMapping("/{id}")
    public R<PmCustomer> update(@PathVariable UUID id, @RequestBody @Valid CustomerReq req) {
        return R.ok(customerService.update(id, getTenantId(), req.name(), req.shortName(), req.active()));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        customerService.delete(id, getTenantId());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    public record CustomerReq(
        @NotBlank String name,
        String shortName,
        UUID teamId,  // 归属团队（PRO/TRIAL；null=默认/本人唯一团队）。仅 create 生效
        Boolean active   // 有效/无效（null=不修改；create 时 null 视为 true）
    ) {
    }
}

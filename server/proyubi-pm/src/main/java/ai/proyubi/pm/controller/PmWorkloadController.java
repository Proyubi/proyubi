package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmWorkloadService;
import ai.proyubi.pm.vo.PmWorkloadItemVO;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 成员负载Controller（PM，跨项目）。
 *
 */
@RestController
@RequestMapping("/app/pm")
@Validated
public class PmWorkloadController {

    private final PmWorkloadService workloadService;

    public PmWorkloadController(PmWorkloadService workloadService) {
        this.workloadService = workloadService;
    }

    /** 跨项目成员负载（所有有指派的任务，可选按成员过滤） */
    @GetMapping("/workload")
    public R<List<PmWorkloadItemVO>> workload(@RequestParam(required = false) String memberId) {
        return R.ok(workloadService.workload(getTenantId(), memberId));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }
}

package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmDependency;
import ai.proyubi.pm.service.PmDependencyService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 任务依赖Controller（PM）
 *
 */
@RestController
@RequestMapping("/app/pm")
@Validated
public class PmDependencyController {

    private final PmDependencyService dependencyService;

    public PmDependencyController(PmDependencyService dependencyService) {
        this.dependencyService = dependencyService;
    }

    @GetMapping("/projects/{projectId}/dependencies")
    public R<List<PmDependency>> listByProject(@PathVariable UUID projectId) {
        return R.ok(dependencyService.listByProject(getTenantId(), projectId));
    }

    @PostMapping("/dependencies")
    public R<PmDependency> create(@RequestBody @Valid CreateDependencyReq req) {
        PmDependency dependency = dependencyService.create(
            getTenantId(), req.projectId(), req.predecessorId(), req.successorId(),
            req.type(), req.lag());
        return R.ok(dependency);
    }

    @DeleteMapping("/dependencies/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        dependencyService.delete(id, getTenantId());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    public record CreateDependencyReq(
        @NotNull UUID projectId,
        @NotNull UUID predecessorId,
        @NotNull UUID successorId,
        String type,
        Integer lag
    ) {
    }
}

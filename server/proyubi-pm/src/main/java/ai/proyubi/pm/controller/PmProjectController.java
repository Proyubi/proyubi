package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.service.PmProjectService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 项目/版本Controller（PM）
 *
 */
@RestController
@RequestMapping("/app/pm/projects")
@Validated
public class PmProjectController {

    private final PmProjectService projectService;

    public PmProjectController(PmProjectService projectService) {
        this.projectService = projectService;
    }

    @GetMapping
    public R<List<PmProject>> list(
        @RequestParam(required = false) UUID customerId,
        @RequestParam(required = false) String status,
        @RequestParam(required = false) UUID teamId
    ) {
        return R.ok(projectService.list(getTenantId(), customerId, status, teamId));
    }

    @GetMapping("/{id}")
    public R<PmProject> get(@PathVariable UUID id) {
        return R.ok(projectService.getByIdAndTenant(id, getTenantId()));
    }

    @PostMapping
    public R<PmProject> create(@RequestBody @Valid CreateProjectReq req) {
        PmProject project = projectService.create(
            getTenantId(), req.customerId(), req.name(), req.description(),
            req.status(), req.kind(), req.start(), req.end(), req.monthlyQuotaMinutes());
        return R.ok(project);
    }

    @PutMapping("/{id}")
    public R<PmProject> update(@PathVariable UUID id, @RequestBody @Valid UpdateProjectReq req) {
        PmProject project = projectService.update(
            id, getTenantId(), req.customerId(), req.name(), req.description(),
            req.status(), req.kind(), req.start(), req.end(),
            Boolean.TRUE.equals(req.clearEnd()), req.monthlyQuotaMinutes());
        return R.ok(project);
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        projectService.delete(id, getTenantId());
        return R.ok();
    }

    /** 拖动排序：按给定顺序重写同一客户下项目的排序 */
    @PutMapping("/reorder")
    public R<Void> reorder(@RequestBody @Valid ReorderReq req) {
        projectService.reorder(getTenantId(), req.customerId(), req.orderedIds());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /**
     * end は敢えて {@code @NotNull} を外している：kind=ops（運用・保守）は
     * 終了日未定＝継続中を許すため。kind=project の必須チェックは
     * {@link ai.proyubi.pm.service.PmProjectService} 側で行う。
     */
    public record CreateProjectReq(
        @NotNull UUID customerId,
        @NotBlank String name,
        String description,
        String status,
        String kind,
        @NotNull LocalDate start,
        LocalDate end,
        /** 月次工数枠（分）。null=未指定、0 以下=枠なしへクリア */
        Integer monthlyQuotaMinutes
    ) {
    }

    public record UpdateProjectReq(
        UUID customerId,
        String name,
        String description,
        String status,
        String kind,
        LocalDate start,
        LocalDate end,
        /** true=終了日を明示的にクリアする（継続中に戻す）。end=null だけでは「未変更」と区別できないため */
        Boolean clearEnd,
        /** 月次工数枠（分）。null=未変更、0 以下=枠なしへクリア */
        Integer monthlyQuotaMinutes
    ) {
    }

    public record ReorderReq(
        @NotNull UUID customerId,
        @NotNull List<UUID> orderedIds
    ) {
    }
}

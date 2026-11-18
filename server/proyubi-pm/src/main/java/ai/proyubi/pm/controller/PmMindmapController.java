package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmMindmap;
import ai.proyubi.pm.service.PmMindmapService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 思维导图 Controller（PM）。/app/pm/mindmaps。
 *
 */
@RestController
@RequestMapping("/app/pm/mindmaps")
@Validated
public class PmMindmapController {

    private final PmMindmapService mindmapService;

    public PmMindmapController(PmMindmapService mindmapService) {
        this.mindmapService = mindmapService;
    }

    /** 列表（摘要，不含 content） */
    @GetMapping
    public R<List<PmMindmap>> list() {
        return R.ok(mindmapService.list(getTenantId()));
    }

    /** 取单图（含 content + version） */
    @GetMapping("/{id}")
    public R<PmMindmap> get(@PathVariable UUID id) {
        return R.ok(mindmapService.getByIdAndTenant(id, getTenantId()));
    }

    @PostMapping
    public R<PmMindmap> create(@RequestBody @Valid CreateReq req) {
        return R.ok(mindmapService.create(
            getTenantId(), req.name(), req.projectId(), req.theme(), req.content()));
    }

    @PutMapping("/{id}")
    public R<PmMindmap> update(@PathVariable UUID id, @RequestBody UpdateReq req) {
        return R.ok(mindmapService.update(
            id, getTenantId(), req.name(), req.projectId(), req.clearProject(),
            req.theme(), req.content(), req.version()));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        mindmapService.delete(id, getTenantId());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    public record CreateReq(
        @NotBlank String name,
        UUID projectId,
        String theme,
        String content
    ) {
    }

    public record UpdateReq(
        String name,
        UUID projectId,
        /** true=显式清空关联项目 */
        Boolean clearProject,
        String theme,
        String content,
        /** content 保存时必传：乐观锁版本 */
        Integer version
    ) {
    }
}

package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmRoadmapOption;
import ai.proyubi.pm.service.PmRoadmapOptionService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 路线图可自定义字典Controller（PM）。
 * 管理租户级「泳道(lane)」「里程碑色(ms_color)」字典。
 *
 */
@RestController
@RequestMapping("/app/pm/roadmap-options")
@Validated
public class PmRoadmapOptionController {

    private final PmRoadmapOptionService optionService;

    public PmRoadmapOptionController(PmRoadmapOptionService optionService) {
        this.optionService = optionService;
    }

    /** 列出当前租户字典项，可选 ?kind=lane|ms_color 过滤 */
    @GetMapping
    public R<List<PmRoadmapOption>> list(@RequestParam(required = false) String kind) {
        return R.ok(optionService.list(getTenantId(), kind));
    }

    @PostMapping
    public R<PmRoadmapOption> create(@RequestBody @Valid CreateReq req) {
        return R.ok(optionService.create(getTenantId(), req.kind(), req.label(), req.color(), req.sortOrder()));
    }

    @PutMapping("/{id}")
    public R<PmRoadmapOption> update(@PathVariable UUID id, @RequestBody @Valid UpdateReq req) {
        return R.ok(optionService.update(id, getTenantId(), req.label(), req.color(), req.sortOrder()));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        optionService.delete(id, getTenantId());
        return R.ok();
    }

    /** 拖动排序：按给定顺序重写同一 kind 下字典项的 sort_order */
    @PutMapping("/reorder")
    public R<Void> reorder(@RequestBody @Valid ReorderReq req) {
        optionService.reorder(getTenantId(), req.kind(), req.orderedIds());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /** 新增：kind 必填（lane/ms_color），label 必填，option_key 后端生成 */
    public record CreateReq(
        @NotNull String kind,
        @NotNull String label,
        String color,
        Integer sortOrder
    ) {
    }

    /** 编辑：仅改名称/颜色/排序 */
    public record UpdateReq(
        String label,
        String color,
        Integer sortOrder
    ) {
    }

    public record ReorderReq(
        @NotNull String kind,
        @NotNull List<UUID> orderedIds
    ) {
    }
}

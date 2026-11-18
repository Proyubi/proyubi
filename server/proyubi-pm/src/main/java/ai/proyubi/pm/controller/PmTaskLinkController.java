package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmTaskLinkService;
import ai.proyubi.pm.vo.PmTaskLinkVO;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 任务关联链接Controller（PM）。
 * 链接挂在任务上：{@code /app/pm/tasks/{taskId}/links} 列表/新增，
 * {@code /app/pm/links/{id}} 删除（任意本租户成员）。
 * 首版无编辑：改链接 = 删除后重加（保持简单）。
 *
 */
@RestController
@RequestMapping("/app/pm")
@Validated
public class PmTaskLinkController {

    private final PmTaskLinkService linkService;

    public PmTaskLinkController(PmTaskLinkService linkService) {
        this.linkService = linkService;
    }

    @GetMapping("/tasks/{taskId}/links")
    public R<List<PmTaskLinkVO>> list(@PathVariable UUID taskId) {
        return R.ok(linkService.list(getTenantId(), taskId));
    }

    @PostMapping("/tasks/{taskId}/links")
    public R<PmTaskLinkVO> create(@PathVariable UUID taskId, @RequestBody @Valid LinkReq req) {
        return R.ok(linkService.create(getTenantId(), taskId, TenantContext.getUserId(), req.url(), req.title()));
    }

    @DeleteMapping("/links/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        linkService.delete(id, getTenantId());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /** 新增链接：url 必填，title 可空 */
    public record LinkReq(@NotBlank String url, String title) {
    }
}

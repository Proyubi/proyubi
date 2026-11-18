package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmCommentService;
import ai.proyubi.pm.vo.PmCommentVO;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 任务评论Controller（PM）。
 * 评论挂在任务上：{@code /app/pm/tasks/{taskId}/comments} 列表/发表，
 * {@code /app/pm/comments/{id}} 编辑/删除（仅本人）。
 *
 */
@RestController
@RequestMapping("/app/pm")
@Validated
public class PmCommentController {

    private final PmCommentService commentService;

    public PmCommentController(PmCommentService commentService) {
        this.commentService = commentService;
    }

    @GetMapping("/tasks/{taskId}/comments")
    public R<List<PmCommentVO>> list(@PathVariable UUID taskId) {
        return R.ok(commentService.list(getTenantId(), taskId, TenantContext.getUserId()));
    }

    @PostMapping("/tasks/{taskId}/comments")
    public R<PmCommentVO> create(@PathVariable UUID taskId, @RequestBody @Valid CommentReq req) {
        return R.ok(commentService.create(getTenantId(), taskId, TenantContext.getUserId(), req.content()));
    }

    @PutMapping("/comments/{id}")
    public R<PmCommentVO> update(@PathVariable UUID id, @RequestBody @Valid CommentReq req) {
        return R.ok(commentService.update(id, getTenantId(), TenantContext.getUserId(), req.content()));
    }

    @DeleteMapping("/comments/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        commentService.delete(id, getTenantId(), TenantContext.getUserId());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /** 发表 / 编辑评论：仅正文 */
    public record CommentReq(@NotBlank String content) {
    }
}

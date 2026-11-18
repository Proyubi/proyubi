package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmDesignFrameService;
import ai.proyubi.pm.service.PmDesignService;
import ai.proyubi.pm.service.PmDesignService.CreateInput;
import ai.proyubi.pm.service.PmDesignService.SaveInput;
import ai.proyubi.pm.service.PmDesignService.SourceInput;
import ai.proyubi.pm.vo.PmDesignCommentVO;
import ai.proyubi.pm.vo.PmDesignFrameVO;
import ai.proyubi.pm.vo.PmDesignVO;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;

import java.util.List;
import java.util.UUID;

/**
 * 設計資産Controller（PM Design Studio、ログイン必須）。
 * 一覧 / 詳細（修訂指定可）/ 新規 / 保存（expectedRevision 必須、競合 409）/ メタ編集 / 削除 / 審査コメント /
 * .pen 原文ダウンロード / 画框（審査ステータス・タスク紐付け）。
 * 設計：work/design-studio/requirements.md §5
 *
 */
@RestController
@RequestMapping("/app/pm/designs")
public class PmDesignController {

    private final PmDesignService designService;
    private final PmDesignFrameService frameService;

    public PmDesignController(PmDesignService designService, PmDesignFrameService frameService) {
        this.designService = designService;
        this.frameService = frameService;
    }

    @GetMapping
    public R<List<PmDesignVO>> list(@RequestParam(required = false) UUID projectId,
                                    @RequestParam(required = false) UUID taskId) {
        return R.ok(designService.list(getTenantId(), projectId, taskId));
    }

    @GetMapping("/{id}")
    public R<PmDesignVO> get(@PathVariable UUID id, @RequestParam(required = false) Integer revision,
                             @RequestParam(defaultValue = "true") boolean content) {
        return R.ok(designService.get(id, getTenantId(), revision, content));
    }

    @PostMapping
    public R<PmDesignVO> create(@RequestBody CreateReq req) {
        return R.ok(designService.create(getTenantId(), TenantContext.getUserId(), req.toInput(), "web"));
    }

    @PutMapping("/{id}/content")
    public R<PmDesignVO> save(@PathVariable UUID id, @RequestBody SaveReq req) {
        return R.ok(designService.save(id, getTenantId(), TenantContext.getUserId(), req.toInput(), "web"));
    }

    @PutMapping("/{id}")
    public R<PmDesignVO> update(@PathVariable UUID id, @RequestBody UpdateReq req) {
        return R.ok(designService.updateMeta(id, getTenantId(), TenantContext.getUserId(), req.title(),
            req.taskId(), Boolean.TRUE.equals(req.clearTask())));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        designService.delete(id, getTenantId(), TenantContext.getUserId());
        return R.ok();
    }

    /** .pen 原文（無改変バイト）。OpenPencil ビューアの読み込みとダウンロードに使う。 */
    @GetMapping("/{id}/source")
    public ResponseEntity<byte[]> source(@PathVariable UUID id, @RequestParam(required = false) Integer revision) {
        PmDesignService.PenSource src = designService.penSource(id, getTenantId(), revision);
        return ResponseEntity.ok()
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                .filename(src.fileName(), StandardCharsets.UTF_8).build().toString())
            .header("X-Design-Revision", String.valueOf(src.revision()))
            .header("X-Content-Sha256", src.sha256())
            .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
            .body(src.bytes());
    }

    @GetMapping("/{id}/frames")
    public R<List<PmDesignFrameVO>> frames(@PathVariable UUID id) {
        return R.ok(frameService.list(id, getTenantId()));
    }

    /** タスクに紐付いた画框（タスク詳細のデザイン欄） */
    @GetMapping("/frames")
    public R<List<PmDesignFrameVO>> framesByTask(@RequestParam UUID taskId) {
        return R.ok(frameService.listByTask(taskId, getTenantId()));
    }

    @PutMapping("/{id}/frames/{nodeId}/status")
    public R<PmDesignFrameVO> setFrameStatus(@PathVariable UUID id, @PathVariable String nodeId,
                                             @RequestBody FrameStatusReq req) {
        return R.ok(frameService.setStatus(id, nodeId, getTenantId(), TenantContext.getUserId(), req.status()));
    }

    @PostMapping("/{id}/frames/{nodeId}/tasks")
    public R<PmDesignFrameVO> linkFrameTask(@PathVariable UUID id, @PathVariable String nodeId,
                                            @RequestBody FrameTaskReq req) {
        return R.ok(frameService.linkTask(id, nodeId, getTenantId(), TenantContext.getUserId(), req.taskId()));
    }

    @DeleteMapping("/{id}/frames/{nodeId}/tasks/{taskId}")
    public R<PmDesignFrameVO> unlinkFrameTask(@PathVariable UUID id, @PathVariable String nodeId,
                                              @PathVariable UUID taskId) {
        return R.ok(frameService.unlinkTask(id, nodeId, getTenantId(), TenantContext.getUserId(), taskId));
    }

    @GetMapping("/{id}/comments")
    public R<List<PmDesignCommentVO>> comments(@PathVariable UUID id, @RequestParam(required = false) Integer revision) {
        return R.ok(designService.listComments(id, getTenantId(), TenantContext.getUserId(), revision));
    }

    @PostMapping("/{id}/comments")
    public R<PmDesignCommentVO> addComment(@PathVariable UUID id, @RequestBody CommentReq req) {
        return R.ok(designService.addComment(id, getTenantId(), TenantContext.getUserId(), req.revision(),
            req.elementId(), req.body(), "web"));
    }

    @PutMapping("/comments/{commentId}")
    public R<PmDesignCommentVO> editComment(@PathVariable UUID commentId, @RequestBody CommentReq req) {
        return R.ok(designService.editComment(commentId, getTenantId(), TenantContext.getUserId(), req.body()));
    }

    @PutMapping("/comments/{commentId}/resolve")
    public R<PmDesignCommentVO> resolve(@PathVariable UUID commentId, @RequestBody ResolveReq req) {
        return R.ok(designService.resolveComment(commentId, getTenantId(), TenantContext.getUserId(),
            Boolean.TRUE.equals(req.resolved())));
    }

    @DeleteMapping("/comments/{commentId}")
    public R<Void> deleteComment(@PathVariable UUID commentId) {
        designService.deleteComment(commentId, getTenantId(), TenantContext.getUserId());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /** 新規：excalidraw は content（省略可）、pen は contentBase64 */
    public record CreateReq(UUID projectId, UUID taskId, String title, String format, String content,
                            String contentBase64, String fileName, String note, SourceInput source) {
        CreateInput toInput() {
            return new CreateInput(projectId, taskId, title, format, content, contentBase64, fileName, note, source);
        }
    }

    /** 保存：expectedRevision 必須。baseSourceHash は Git から取り込み直す場合のみ */
    public record SaveReq(Integer expectedRevision, String content, String contentBase64, String fileName,
                          String note, SourceInput source, String baseSourceHash) {
        SaveInput toInput() {
            return new SaveInput(expectedRevision, content, contentBase64, fileName, note, source, baseSourceHash);
        }
    }

    /** メタ編集：null = 変更なし。紐付け解除は clearTask */
    public record UpdateReq(String title, UUID taskId, Boolean clearTask) {
    }

    /** コメント：revision 省略 = 最新修訂。elementId = .pen は画框の node_id（省略 = 版全体へのコメント） */
    public record CommentReq(Integer revision, String elementId, String body) {
    }

    public record ResolveReq(Boolean resolved) {
    }

    /** 画框の審査ステータス：draft / review / changes / approved */
    public record FrameStatusReq(String status) {
    }

    public record FrameTaskReq(UUID taskId) {
    }
}

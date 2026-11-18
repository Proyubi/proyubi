package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.controller.PmDesignController.CommentReq;
import ai.proyubi.pm.controller.PmDesignController.CreateReq;
import ai.proyubi.pm.controller.PmDesignController.FrameStatusReq;
import ai.proyubi.pm.controller.PmDesignController.FrameTaskReq;
import ai.proyubi.pm.controller.PmDesignController.SaveReq;
import ai.proyubi.pm.service.PmDesignFrameService;
import ai.proyubi.pm.service.PmDesignService;
import ai.proyubi.pm.service.PmMockupUrlSigner;
import ai.proyubi.pm.vo.PmDesignCommentVO;
import ai.proyubi.pm.vo.PmDesignFrameVO;
import ai.proyubi.pm.vo.PmDesignVO;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 設計資産の機械用内部接口（/internal/pm/designs、pm-mcp の pm_*_design* ツール）。
 * 読み書きとも X-User-Id 必須：租户 API キーだけ（ユーザーなし）では団队可視性を越えてしまうため受け付けない。
 * 書き込みの via は mcp。応答の appUrl は PM 画面でこの設計を開く URL。
 * サーバ上のローカルファイルパスは一切受け付けない（内容は JSON 本文でのみ受け取る）。
 *
 */
@RestController
@RequestMapping("/internal/pm/designs")
public class PmDesignInternalController {

    private final PmDesignService designService;
    private final PmDesignFrameService frameService;
    /** PM 画面のベース URL（proyubi.pm.mockup.web-base-url を共用） */
    private final PmMockupUrlSigner signer;

    public PmDesignInternalController(PmDesignService designService, PmDesignFrameService frameService,
                                      PmMockupUrlSigner signer) {
        this.designService = designService;
        this.frameService = frameService;
        this.signer = signer;
    }

    @GetMapping
    public R<List<McpDesign>> list(@RequestParam(required = false) UUID projectId,
                                   @RequestParam(required = false) UUID taskId) {
        requireUser();
        return R.ok(designService.list(getTenantId(), projectId, taskId).stream().map(this::wrap).toList());
    }

    @GetMapping("/{id}")
    public R<McpDesign> get(@PathVariable UUID id, @RequestParam(required = false) Integer revision) {
        requireUser();
        return R.ok(wrap(designService.get(id, getTenantId(), revision)));
    }

    @PostMapping
    public R<McpDesign> create(@RequestBody CreateReq req) {
        return R.ok(wrap(designService.create(getTenantId(), requireUser(), req.toInput(), "mcp")));
    }

    @PutMapping("/{id}/content")
    public R<McpDesign> save(@PathVariable UUID id, @RequestBody SaveReq req) {
        return R.ok(wrap(designService.save(id, getTenantId(), requireUser(), req.toInput(), "mcp")));
    }

    @GetMapping("/{id}/comments")
    public R<List<PmDesignCommentVO>> comments(@PathVariable UUID id, @RequestParam(required = false) Integer revision) {
        return R.ok(designService.listComments(id, getTenantId(), requireUser(), revision));
    }

    @PostMapping("/{id}/comments")
    public R<PmDesignCommentVO> addComment(@PathVariable UUID id, @RequestBody CommentReq req) {
        return R.ok(designService.addComment(id, getTenantId(), requireUser(), req.revision(), req.elementId(),
            req.body(), "mcp"));
    }

    /** .pen の画框一覧（審査ステータス・紐付けタスク・未解決コメント数） */
    @GetMapping("/{id}/frames")
    public R<List<PmDesignFrameVO>> frames(@PathVariable UUID id) {
        requireUser();
        return R.ok(frameService.list(id, getTenantId()));
    }

    @PutMapping("/{id}/frames/{nodeId}/status")
    public R<PmDesignFrameVO> setFrameStatus(@PathVariable UUID id, @PathVariable String nodeId,
                                             @RequestBody FrameStatusReq req) {
        return R.ok(frameService.setStatus(id, nodeId, getTenantId(), requireUser(), req.status()));
    }

    @PostMapping("/{id}/frames/{nodeId}/tasks")
    public R<PmDesignFrameVO> linkFrameTask(@PathVariable UUID id, @PathVariable String nodeId,
                                            @RequestBody FrameTaskReq req) {
        return R.ok(frameService.linkTask(id, nodeId, getTenantId(), requireUser(), req.taskId()));
    }

    @DeleteMapping("/{id}/frames/{nodeId}/tasks/{taskId}")
    public R<PmDesignFrameVO> unlinkFrameTask(@PathVariable UUID id, @PathVariable String nodeId,
                                              @PathVariable UUID taskId) {
        return R.ok(frameService.unlinkTask(id, nodeId, getTenantId(), requireUser(), taskId));
    }

    private McpDesign wrap(PmDesignVO vo) {
        return new McpDesign(vo, signer.webBaseUrl() + "/projects/" + vo.projectId() + "/gantt?tab=design&open=" + vo.id());
    }

    private UUID requireUser() {
        UUID userId = TenantContext.getUserId();
        if (userId == null) {
            throw BizException.of(401, "X-User-Id がありません（デザインはユーザー単位でのみ読み書きできます）");
        }
        designService.requireActor(getTenantId(), userId);
        return userId;
    }

    private static UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(400, "缺少 X-Tenant-Id");
        }
        return tenantId;
    }

    /** MCP 応答：設計 + PM 画面で開く URL */
    public record McpDesign(PmDesignVO design, String appUrl) {
    }
}

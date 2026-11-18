package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmMockupBundle;
import ai.proyubi.pm.service.PmMockupService;
import ai.proyubi.pm.service.PmMockupService.PublishInput;
import ai.proyubi.pm.vo.PmMockupVO;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

/**
 * モックアップの機械用内部接口（/internal/pm/mockups、pm-mcp の pm_publish_mockup / pm_list_mockups）。
 * 公開者は X-User-Id（pm-mcp が MCP トークンから解決した本人）で受け取り、版の via は mcp。
 * 応答には PM 画面で開く appUrl と、共有有効時の shareUrl を付ける。
 *
 */
@RestController
@RequestMapping("/internal/pm/mockups")
public class PmMockupInternalController {

    private final PmMockupService mockupService;

    public PmMockupInternalController(PmMockupService mockupService) {
        this.mockupService = mockupService;
    }

    @GetMapping
    public R<List<McpMockup>> list(@RequestParam(required = false) UUID projectId,
                                   @RequestParam(required = false) UUID taskId,
                                   @RequestParam(required = false) UUID bugId) {
        return R.ok(mockupService.list(getTenantId(), projectId, taskId, bugId).stream().map(this::wrap).toList());
    }

    @PostMapping
    @Transactional
    public R<McpMockup> publish(@RequestBody PublishReq req) {
        UUID tenantId = getTenantId();
        UUID userId = TenantContext.getUserId();
        if (userId == null) {
            throw BizException.of(400, "公開者が特定できません（X-User-Id 欠落）");
        }
        PmMockupVO vo = mockupService.publish(tenantId, userId,
            new PublishInput(readBundle(req), req.title(), req.projectId(), req.taskId(), req.bugId(),
                req.mockupId(), req.note()), "mcp");
        if (Boolean.TRUE.equals(req.share())) {
            vo = mockupService.ensureShared(vo.id(), tenantId);
        }
        return R.ok(wrap(vo));
    }

    /** html / zipBase64 / files のどれか 1 つ。 */
    private PmMockupBundle readBundle(PublishReq req) {
        int given = (req.html() != null ? 1 : 0) + (req.zipBase64() != null ? 1 : 0) + (req.files() != null ? 1 : 0);
        if (given != 1) {
            throw BizException.of(400, "html / zipBase64 / files のいずれか 1 つを指定してください");
        }
        if (req.html() != null) {
            return mockupService.readHtml(req.html());
        }
        if (req.zipBase64() != null) {
            return mockupService.readZip(decode(req.zipBase64(), "zipBase64"));
        }
        List<PmMockupBundle.RawFile> files = new ArrayList<>();
        for (McpFile f : req.files()) {
            if (f == null || f.path() == null || f.base64() == null) {
                throw BizException.of(400, "files の各要素には path と base64 が必要です");
            }
            files.add(new PmMockupBundle.RawFile(f.path(), decode(f.base64(), f.path())));
        }
        return mockupService.readFiles(files);
    }

    private static byte[] decode(String base64, String what) {
        try {
            return Base64.getDecoder().decode(base64);
        } catch (IllegalArgumentException e) {
            throw BizException.of(400, what + " が base64 ではありません");
        }
    }

    private McpMockup wrap(PmMockupVO vo) {
        return new McpMockup(vo, mockupService.appUrl(vo), mockupService.shareUrl(vo));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(400, "缺少 X-Tenant-Id");
        }
        return tenantId;
    }

    /**
     * 内容は html（単一 HTML）/ zipBase64（zip）/ files（フォルダ公開：版ルートからの相対パス + base64）のどれか 1 つ。
     * share=true：未共有なら 30 日で共有を有効化
     */
    public record PublishReq(String html, String zipBase64, List<McpFile> files, String title, UUID projectId,
                             UUID taskId, UUID bugId, UUID mockupId, String note, Boolean share) {
    }

    /** フォルダ公開の 1 ファイル */
    public record McpFile(String path, String base64) {
    }

    /** MCP 応答：モックアップ + PM 画面 URL + 共有 URL（未共有は null） */
    public record McpMockup(PmMockupVO mockup, String appUrl, String shareUrl) {
    }
}

package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmMockupBundle;
import ai.proyubi.pm.service.PmMockupService;
import ai.proyubi.pm.service.PmMockupService.PublishInput;
import ai.proyubi.pm.vo.PmMockupVO;
import org.springframework.http.MediaType;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * モックアップController（PM、ログイン必須）。
 * 一覧 / 詳細 / 公開（新規・新版、HTML / zip）/ メタ編集 / 削除 / 版削除 / 署名付き原文 URL / 共有設定。
 * 設計：doc/design/pm-mockup.md §3
 *
 */
@RestController
@RequestMapping("/app/pm/mockups")
@Validated
public class PmMockupController {

    private final PmMockupService mockupService;

    public PmMockupController(PmMockupService mockupService) {
        this.mockupService = mockupService;
    }

    @GetMapping
    public R<List<PmMockupVO>> list(@RequestParam(required = false) UUID projectId,
                                    @RequestParam(required = false) UUID taskId,
                                    @RequestParam(required = false) UUID bugId) {
        return R.ok(mockupService.list(getTenantId(), projectId, taskId, bugId));
    }

    @GetMapping("/{id}")
    public R<PmMockupVO> get(@PathVariable UUID id) {
        return R.ok(mockupService.get(id, getTenantId()));
    }

    @PostMapping
    public R<PmMockupVO> publish(@RequestBody PublishReq req) {
        return R.ok(mockupService.publish(getTenantId(), TenantContext.getUserId(),
            new PublishInput(mockupService.readHtml(req.html()), req.title(), req.projectId(), req.taskId(),
                req.bugId(), req.mockupId(), req.note()), "web"));
    }

    /**
     * ファイルで公開（画面のアップロード）。.html / .htm はそのまま、.zip は展開して入口 HTML + 付属ファイル。
     * 判定は拡張子 → 先頭の zip シグネチャ（PK\3\4）の順。
     */
    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public R<PmMockupVO> upload(@RequestParam("file") MultipartFile file,
                                @RequestParam(required = false) String title,
                                @RequestParam(required = false) UUID projectId,
                                @RequestParam(required = false) UUID taskId,
                                @RequestParam(required = false) UUID bugId,
                                @RequestParam(required = false) UUID mockupId,
                                @RequestParam(required = false) String note) throws IOException {
        byte[] bytes = file.getBytes();
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase(Locale.ROOT);
        boolean zip = name.endsWith(".zip")
            || (bytes.length >= 4 && bytes[0] == 'P' && bytes[1] == 'K' && bytes[2] == 3 && bytes[3] == 4);
        PmMockupBundle bundle;
        if (zip) {
            bundle = mockupService.readZip(bytes);
        } else if (name.endsWith(".html") || name.endsWith(".htm")) {
            bundle = mockupService.readHtml(new String(bytes, StandardCharsets.UTF_8));
        } else {
            throw BizException.of(400, ".html または .zip ファイルを選んでください");
        }
        return R.ok(mockupService.publish(getTenantId(), TenantContext.getUserId(),
            new PublishInput(bundle, title, projectId, taskId, bugId, mockupId, note), "web"));
    }

    @PutMapping("/{id}")
    public R<PmMockupVO> update(@PathVariable UUID id, @RequestBody UpdateReq req) {
        return R.ok(mockupService.update(id, getTenantId(), req.title(), req.taskId(), req.bugId(),
            Boolean.TRUE.equals(req.clearTask()), Boolean.TRUE.equals(req.clearBug())));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        mockupService.delete(id, getTenantId());
        return R.ok();
    }

    @DeleteMapping("/{id}/versions/{version}")
    public R<PmMockupVO> deleteVersion(@PathVariable UUID id, @PathVariable int version) {
        return R.ok(mockupService.deleteVersion(id, getTenantId(), version));
    }

    @GetMapping("/{id}/view-url")
    public R<PmMockupVO.ViewUrl> viewUrl(@PathVariable UUID id, @RequestParam(required = false) Integer version) {
        return R.ok(mockupService.viewUrl(id, getTenantId(), version));
    }

    @PutMapping("/{id}/share")
    public R<PmMockupVO> share(@PathVariable UUID id, @RequestBody ShareReq req) {
        return R.ok(mockupService.updateShare(id, getTenantId(), Boolean.TRUE.equals(req.enabled()),
            req.expiresInDays(), req.pinnedVersion()));
    }

    @PostMapping("/{id}/share/regenerate")
    public R<PmMockupVO> regenerate(@PathVariable UUID id) {
        return R.ok(mockupService.regenerateShare(id, getTenantId()));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /** 公開（単一 HTML の JSON 版）：mockupId 指定 = 新版（紐付けパラメータは無視） */
    public record PublishReq(String html, String title, UUID projectId, UUID taskId, UUID bugId,
                             UUID mockupId, String note) {
    }

    /** メタ編集：null = 変更なし。紐付けを外すのは clearTask / clearBug */
    public record UpdateReq(String title, UUID taskId, UUID bugId, Boolean clearTask, Boolean clearBug) {
    }

    /** 共有設定：expiresInDays null = 無期限、pinnedVersion null = 常に最新版 */
    public record ShareReq(Boolean enabled, Integer expiresInDays, Integer pinnedVersion) {
    }
}

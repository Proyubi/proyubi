package ai.proyubi.pm.controller;

import com.fasterxml.jackson.annotation.JsonProperty;
import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmDocService;
import ai.proyubi.pm.vo.PmDocVO;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 资料Controller（PM）。外部网盘资料链接 + 顧客 / 案件 / タスク 对应关系。
 * <ul>
 *   <li>{@code GET /app/pm/customers/{customerId}/docs}：顧客共通 + 可见案件的资料</li>
 *   <li>{@code GET /app/pm/projects/{projectId}/docs}：案件资料</li>
 *   <li>{@code GET /app/pm/tasks/{taskId}/docs}：挂在任务上的资料</li>
 *   <li>{@code POST /app/pm/docs} / {@code PATCH /app/pm/docs/{id}} / {@code DELETE /app/pm/docs/{id}}</li>
 *   <li>{@code POST /app/pm/docs/batch}：Google Picker 多选一次登记</li>
 *   <li>{@code GET /app/pm/docs/picker-config}：前端 Google Picker 所需的公开配置</li>
 * </ul>
 * 设计：doc/design/pm-drive-docs.md §4 / §7
 *
 */
@RestController
@RequestMapping("/app/pm")
@Validated
public class PmDocController {

    private final PmDocService docService;
    private final String pickerClientId;
    private final String pickerApiKey;
    private final String pickerAppId;

    public PmDocController(PmDocService docService,
                           @Value("${google.picker.client-id:}") String pickerClientId,
                           @Value("${google.picker.api-key:}") String pickerApiKey,
                           @Value("${google.picker.app-id:}") String pickerAppId) {
        this.docService = docService;
        this.pickerClientId = pickerClientId;
        this.pickerApiKey = pickerApiKey;
        this.pickerAppId = pickerAppId;
    }

    /**
     * Google Picker 配置。三项都是浏览器端公开值（API Key 靠 referrer 限制保护），不含任何 secret。
     * 任一项未配置 → enabled=false，前端隐藏「Google ドライブから選択」。
     */
    @GetMapping("/docs/picker-config")
    public R<PickerConfig> pickerConfig() {
        boolean enabled = notBlank(pickerClientId) && notBlank(pickerApiKey) && notBlank(pickerAppId);
        return R.ok(enabled
            ? new PickerConfig(true, pickerClientId.trim(), pickerApiKey.trim(), pickerAppId.trim())
            : new PickerConfig(false, null, null, null));
    }

    @GetMapping("/customers/{customerId}/docs")
    public R<List<PmDocVO>> listByCustomer(@PathVariable UUID customerId) {
        return R.ok(docService.listByCustomer(getTenantId(), customerId));
    }

    @GetMapping("/projects/{projectId}/docs")
    public R<List<PmDocVO>> listByProject(@PathVariable UUID projectId) {
        return R.ok(docService.listByProject(getTenantId(), projectId));
    }

    @GetMapping("/tasks/{taskId}/docs")
    public R<List<PmDocVO>> listByTask(@PathVariable UUID taskId) {
        return R.ok(docService.listByTask(getTenantId(), taskId));
    }

    @PostMapping("/docs")
    public R<PmDocVO> create(@RequestBody @Valid CreateReq req) {
        return R.ok(docService.create(getTenantId(), TenantContext.getUserId(), req.customerId(), req.projectId(),
            req.url(), req.title(), req.mimeType(), req.taskIds(), req.isRoot()));
    }

    @PostMapping("/docs/batch")
    public R<List<PmDocVO>> createBatch(@RequestBody BatchReq req) {
        return R.ok(docService.createBatch(getTenantId(), TenantContext.getUserId(), req.customerId(), req.projectId(),
            req.taskIds(), req.items()));
    }

    @PatchMapping("/docs/{id}")
    public R<PmDocVO> update(@PathVariable UUID id, @RequestBody UpdateReq req) {
        return R.ok(docService.update(id, getTenantId(), TenantContext.getUserId(), req.title(), req.taskIds()));
    }

    @DeleteMapping("/docs/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        docService.delete(id, getTenantId());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /** 新增资料：projectId 优先（customerId 从案件取）；二者都没有 → 400 */
    public record CreateReq(UUID customerId, UUID projectId, @NotBlank String url, String title, String mimeType,
                            List<UUID> taskIds, @JsonProperty("isRoot") Boolean isRoot) {
    }

    /** 批量登记：scope / taskIds 对全部 items 生效；items 1..50 */
    public record BatchReq(UUID customerId, UUID projectId, List<UUID> taskIds, List<PmDocService.BatchItem> items) {
    }

    /** Google Picker 前端配置（appId = Google Cloud 项目编号） */
    public record PickerConfig(boolean enabled, String clientId, String apiKey, String appId) {
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    /** 编辑资料：title / taskIds 为 null 表示不变；taskIds 非 null 时整体替换 */
    public record UpdateReq(String title, List<UUID> taskIds) {
    }
}

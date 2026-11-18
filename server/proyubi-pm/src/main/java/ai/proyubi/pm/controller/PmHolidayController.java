package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmHoliday;
import ai.proyubi.pm.service.PmHolidayService;
import ai.proyubi.pm.service.PmHolidayService.ImportRow;
import ai.proyubi.pm.service.PmHolidayService.SyncResult;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 节假日（红日子 / 祝日）Controller（PM）。租户级，修改对整个团队生效。
 * 工期按工作日计算时会排除「周末 + 本表内日期」。
 *
 */
@RestController
@RequestMapping("/app/pm/holidays")
@Validated
public class PmHolidayController {

    private final PmHolidayService holidayService;

    public PmHolidayController(PmHolidayService holidayService) {
        this.holidayService = holidayService;
    }

    /** 列出当前租户节假日，可选 ?from=YYYY-MM-DD&to=YYYY-MM-DD 过滤 */
    @GetMapping
    public R<List<PmHoliday>> list(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return R.ok(holidayService.list(getTenantId(), from, to));
    }

    @PostMapping
    public R<PmHoliday> create(@RequestBody @Valid UpsertReq req) {
        return R.ok(holidayService.create(getTenantId(), req.date(), req.name()));
    }

    @PutMapping("/{id}")
    public R<PmHoliday> update(@PathVariable UUID id, @RequestBody @Valid UpsertReq req) {
        return R.ok(holidayService.update(id, getTenantId(), req.date(), req.name()));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        holidayService.delete(id, getTenantId());
        return R.ok();
    }

    /** 批量导入（手动）：跳过已存在日期，返回新增条数 */
    @PostMapping("/import")
    public R<Integer> bulkImport(@RequestBody @Valid ImportReq req) {
        List<ImportRow> rows = req.rows().stream()
            .map(r -> new ImportRow(r.date(), r.name()))
            .toList();
        return R.ok(holidayService.bulkImport(getTenantId(), rows));
    }

    /** 立即从 holidays-jp 同步当前租户祝日 */
    @PostMapping("/sync")
    public R<SyncResult> sync() {
        return R.ok(holidayService.syncFromSource(getTenantId()));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /** 新增/编辑：date + name 必填 */
    public record UpsertReq(
        @NotNull LocalDate date,
        @NotNull String name
    ) {
    }

    public record ImportReq(
        @NotNull List<@Valid ImportRowReq> rows
    ) {
    }

    public record ImportRowReq(
        @NotNull LocalDate date,
        @NotNull String name
    ) {
    }
}

package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmEventService;
import ai.proyubi.pm.service.PmEventService.EventInput;
import ai.proyubi.pm.vo.PmEventVO;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 事件/会议日程Controller（PM）。
 * 嵌入 /calendar 月历的事件 CRUD：区间查询 + 新建/更新/软删。
 * 风格照抄 PmCommentController（getTenantId 401 守卫）+ PmOverviewController（@DateTimeFormat）。
 *
 */
@RestController
@RequestMapping("/app/pm")
@Validated
public class PmEventController {

    private final PmEventService eventService;

    public PmEventController(PmEventService eventService) {
        this.eventService = eventService;
    }

    /**
     * 区间事件列表（start_at/end_at 与 [from,to] 相交）。
     *
     * @param from  区间起 YYYY-MM-DD（含）
     * @param to    区间止 YYYY-MM-DD（含）
     * @param scope "all"=全员（默认）；"me"=仅本人参加
     */
    @GetMapping("/events")
    public R<List<PmEventVO>> list(
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
        @RequestParam(required = false, defaultValue = "all") String scope) {
        return R.ok(eventService.list(getTenantId(), TenantContext.getUserId(), scope, from, to));
    }

    @PostMapping("/events")
    public R<PmEventVO> create(@RequestBody @Valid EventReq req) {
        return R.ok(eventService.create(getTenantId(), TenantContext.getUserId(), req.toInput()));
    }

    @PutMapping("/events/{id}")
    public R<PmEventVO> update(@PathVariable UUID id, @RequestBody @Valid EventReq req) {
        return R.ok(eventService.update(id, getTenantId(), req.toInput()));
    }

    @DeleteMapping("/events/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        eventService.delete(id, getTenantId());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /**
     * 新建/更新事件入参。projectId/taskId 用 String 接收避免空串绑定 UUID 报错（service 内转 UUID）；
     * 时间用 LocalDateTime 让 Spring 直接绑定 ISO 字符串；type 5 枚举由 service 二次校验。
     */
    public record EventReq(
        @NotBlank String title,
        @NotBlank String type,
        @NotNull LocalDateTime startAt,
        LocalDateTime endAt,
        Boolean allDay,
        String projectId,
        String taskId,
        List<String> attendeeIds,
        String location,
        String note
    ) {
        EventInput toInput() {
            return new EventInput(title, type, startAt, endAt, allDay,
                projectId, taskId, attendeeIds, location, note);
        }
    }
}

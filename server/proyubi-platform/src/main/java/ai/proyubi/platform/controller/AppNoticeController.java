package ai.proyubi.platform.controller;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.mybatisflex.core.paginate.Page;
import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.common.satoken.stp.StpTenant;
import ai.proyubi.platform.domain.Notice;
import ai.proyubi.platform.service.NoticeService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 租户端通知公告控制器（只读）
 */
@RestController
@RequestMapping("/app/notices")
@RequiredArgsConstructor
public class AppNoticeController {

    private final NoticeService noticeService;

    @GetMapping
    public R<Map<String, Object>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size
    ) {
        StpTenant.checkLogin();
        UUID userId = getUserId();

        Page<Notice> pageResult = noticeService.listActiveNotices(page, size);
        Set<UUID> readIds = noticeService.getReadNoticeIds(userId);

        List<AppNoticeVO> voList = pageResult.getRecords().stream()
            .map(n -> AppNoticeVO.from(n, readIds.contains(n.getId())))
            .collect(Collectors.toList());

        Map<String, Object> result = new HashMap<>();
        result.put("list", voList);
        result.put("total", pageResult.getTotalRow());
        result.put("page", page);
        result.put("size", size);
        return R.ok(result);
    }

    @GetMapping("/{id}")
    public R<AppNoticeVO> detail(@PathVariable UUID id) {
        StpTenant.checkLogin();
        UUID userId = getUserId();
        Notice notice = noticeService.getById(id);
        Set<UUID> readIds = noticeService.getReadNoticeIds(userId);
        return R.ok(AppNoticeVO.from(notice, readIds.contains(notice.getId())));
    }

    @GetMapping("/unread-count")
    public R<Map<String, Object>> unreadCount() {
        StpTenant.checkLogin();
        UUID userId = getUserId();
        int count = noticeService.getUnreadCount(userId);
        return R.ok(Map.of("count", count));
    }

    @PutMapping("/read-all")
    public R<Void> markAllAsRead() {
        StpTenant.checkLogin();
        UUID userId = getUserId();
        noticeService.markAllAsRead(userId);
        return R.ok();
    }

    @PutMapping("/{id}/read")
    public R<Void> markAsRead(@PathVariable UUID id) {
        StpTenant.checkLogin();
        UUID userId = getUserId();
        noticeService.markAsRead(id, userId);
        return R.ok();
    }

    @PutMapping("/batch-read")
    public R<Void> batchMarkAsRead(@RequestBody Map<String, List<String>> body) {
        StpTenant.checkLogin();
        UUID userId = getUserId();
        List<String> ids = body.get("ids");
        if (ids != null && !ids.isEmpty()) {
            List<UUID> uuids = ids.stream().map(UUID::fromString).collect(Collectors.toList());
            noticeService.batchMarkAsRead(uuids, userId);
        }
        return R.ok();
    }

    private UUID getUserId() {
        UUID userId = TenantContext.getUserId();
        if (userId == null) {
            throw BizException.of(401, "未登录");
        }
        return userId;
    }

    // ========== VO ==========

    public static class AppNoticeVO {
        private UUID id;
        private String noticeTitle;
        private String noticeType;
        private String noticeContent;
        private boolean isRead;
        private String createdAt;

        public static AppNoticeVO from(Notice notice, boolean isRead) {
            AppNoticeVO vo = new AppNoticeVO();
            vo.setId(notice.getId());
            vo.setNoticeTitle(notice.getNoticeTitle());
            vo.setNoticeType(notice.getNoticeType());
            vo.setNoticeContent(notice.getNoticeContent());
            vo.setRead(isRead);
            vo.setCreatedAt(notice.getCreatedAt() != null ? notice.getCreatedAt().toString() : null);
            return vo;
        }

        public UUID getId() { return id; }
        public void setId(UUID id) { this.id = id; }
        public String getNoticeTitle() { return noticeTitle; }
        public void setNoticeTitle(String noticeTitle) { this.noticeTitle = noticeTitle; }
        public String getNoticeType() { return noticeType; }
        public void setNoticeType(String noticeType) { this.noticeType = noticeType; }
        public String getNoticeContent() { return noticeContent; }
        public void setNoticeContent(String noticeContent) { this.noticeContent = noticeContent; }
        @JsonProperty("read")
        public boolean isRead() { return isRead; }
        public void setRead(boolean read) { isRead = read; }
        public String getCreatedAt() { return createdAt; }
        public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }
    }
}

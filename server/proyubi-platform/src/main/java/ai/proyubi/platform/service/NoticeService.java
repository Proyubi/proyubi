package ai.proyubi.platform.service;

import com.mybatisflex.core.paginate.Page;
import com.mybatisflex.core.query.QueryWrapper;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.platform.domain.Notice;
import ai.proyubi.platform.mapper.NoticeMapper;
import ai.proyubi.platform.mapper.NoticeReadMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.*;

import static ai.proyubi.platform.domain.table.NoticeTableDef.NOTICE;

@Service
@RequiredArgsConstructor
public class NoticeService {

    private final NoticeMapper noticeMapper;
    private final NoticeReadMapper noticeReadMapper;

    public Notice getById(UUID id) {
        Notice notice = noticeMapper.selectOneById(id);
        if (notice == null || notice.getDeletedAt() != null) {
            throw BizException.of(404, "通知公告不存在");
        }
        return notice;
    }

    @Transactional
    public Notice create(String noticeTitle, String noticeType,
                         String noticeContent, String status,
                         String remark, String createdBy) {
        Notice notice = new Notice();
        notice.setId(UUID.randomUUID());
        notice.setNoticeTitle(noticeTitle);
        notice.setNoticeType(noticeType != null ? noticeType : "NOTICE");
        notice.setNoticeContent(noticeContent);
        notice.setStatus(status != null ? status : "ACTIVE");
        notice.setRemark(remark);
        notice.setCreatedBy(createdBy);
        notice.setUpdatedBy(createdBy);
        notice.setCreatedAt(OffsetDateTime.now());
        notice.setUpdatedAt(OffsetDateTime.now());
        noticeMapper.insert(notice);
        return notice;
    }

    @Transactional
    public Notice update(UUID id, String noticeTitle, String noticeType,
                         String noticeContent, String status,
                         String remark, String updatedBy) {
        Notice notice = getById(id);
        if (noticeTitle != null) notice.setNoticeTitle(noticeTitle);
        if (noticeType != null) notice.setNoticeType(noticeType);
        if (noticeContent != null) notice.setNoticeContent(noticeContent);
        if (status != null) notice.setStatus(status);
        if (remark != null) notice.setRemark(remark);
        notice.setUpdatedBy(updatedBy);
        notice.setUpdatedAt(OffsetDateTime.now());
        noticeMapper.update(notice);
        return notice;
    }

    @Transactional
    public void delete(UUID id) {
        Notice notice = getById(id);
        notice.setDeletedAt(OffsetDateTime.now());
        noticeMapper.update(notice);
    }

    // ========== Tenant-facing methods ==========

    public Page<Notice> listActiveNotices(int page, int size) {
        QueryWrapper qw = QueryWrapper.create()
            .from(NOTICE)
            .where(NOTICE.STATUS.eq("ACTIVE"))
            .and(NOTICE.DELETED_AT.isNull())
            .orderBy(NOTICE.CREATED_AT.desc());
        return noticeMapper.paginate(Page.of(page, size), qw);
    }

    public int getUnreadCount(UUID userId) {
        return noticeReadMapper.countUnread(userId);
    }

    @Transactional
    public void markAsRead(UUID noticeId, UUID userId) {
        noticeReadMapper.markAsRead(noticeId, userId);
    }

    @Transactional
    public int markAllAsRead(UUID userId) {
        return noticeReadMapper.markAllAsRead(userId);
    }

    @Transactional
    public void batchMarkAsRead(List<UUID> noticeIds, UUID userId) {
        for (UUID noticeId : noticeIds) {
            noticeReadMapper.markAsRead(noticeId, userId);
        }
    }

    public Set<UUID> getReadNoticeIds(UUID userId) {
        return new HashSet<>(noticeReadMapper.selectReadNoticeIds(userId));
    }
}

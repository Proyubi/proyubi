import { BellOutlined } from "@ant-design/icons";
import { history, useIntl } from "@umijs/max";
import { Badge, Empty, Popover, Spin, Tabs, Typography } from "antd";
import dayjs from "dayjs";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  getNotices,
  getUnreadCount,
  markNoticeAsRead,
} from "@/services/platform/notice";

const NoticeIcon: React.FC = () => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notices, setNotices] = useState<API.Notice[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await getUnreadCount();
      setUnreadCount(data?.count ?? 0);
    } catch {
      // silent
    }
  }, []);

  const fetchNotices = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNotices({ page: 1, size: 50 });
      setNotices(data?.list ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll unread count every 60s
  useEffect(() => {
    fetchUnreadCount();
    timerRef.current = setInterval(fetchUnreadCount, 60000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchUnreadCount]);

  // Fetch notices when popover opens
  useEffect(() => {
    if (open) {
      fetchNotices();
    }
  }, [open, fetchNotices]);

  const handleClickNotice = (item: API.Notice) => {
    if (!item.read) {
      markNoticeAsRead(item.id).catch(() => {});
      setNotices((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    history.push(`/settings/notice/${item.id}`);
  };

  const noticeTab = (
    <Spin spinning={loading}>
      {notices.length === 0 ? (
        <div style={{ padding: "24px 0" }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={intl.formatMessage({ id: "notice.empty" })}
          />
        </div>
      ) : (
        <>
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {notices.map((item) => (
              <div
                key={item.id}
                onClick={() => handleClickNotice(item)}
                style={{
                  cursor: "pointer",
                  padding: "12px 16px",
                  borderBottom: "1px solid #f0f0f0",
                  background: item.read
                    ? "transparent"
                    : "rgba(22, 119, 255, 0.02)",
                }}
              >
                <div
                  style={{
                    fontWeight: item.read ? 400 : 500,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 4,
                  }}
                >
                  {!item.read && (
                    <span
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#1677ff",
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span style={{ flex: 1 }}>{item.noticeTitle}</span>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {item.createdAt
                    ? dayjs(item.createdAt).format("YYYY-MM-DD HH:mm")
                    : ""}
                </Typography.Text>
              </div>
            ))}
          </div>
        </>
      )}
    </Spin>
  );

  const todoTab = (
    <div style={{ padding: "24px 0" }}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={intl.formatMessage({ id: "notice.todo.empty" })}
      />
    </div>
  );

  const handleViewAll = () => {
    setOpen(false);
    history.push("/notifications");
  };

  const content = (
    <div style={{ width: 336 }}>
      <Tabs
        centered
        items={[
          {
            key: "notices",
            label: intl.formatMessage({ id: "notice.tab.system" }),
            children: noticeTab,
          },
          {
            key: "todo",
            label: intl.formatMessage({ id: "notice.tab.todo" }),
            children: todoTab,
          },
        ]}
      />
      <div
        style={{
          textAlign: "center",
          padding: "8px 0",
          borderTop: "1px solid #f0f0f0",
          cursor: "pointer",
        }}
        onClick={handleViewAll}
      >
        <Typography.Link style={{ fontSize: 13 }}>
          {intl.formatMessage({ id: "notice.viewAll" })}
        </Typography.Link>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      arrow={false}
      styles={{ root: { padding: 0 } }}
    >
      <span className="header-action">
        <Badge count={unreadCount} size="small" offset={[2, -2]}>
          <BellOutlined style={{ fontSize: 16 }} />
        </Badge>
      </span>
    </Popover>
  );
};

export default NoticeIcon;

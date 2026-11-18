import { history, useIntl } from "@umijs/max";
import { Badge, Button, Card, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import React, { useCallback, useEffect, useState } from "react";
import {
  batchMarkNoticesAsRead,
  getNotices,
  markAllNoticesAsRead,
} from "@/services/platform/notice";

const { Text } = Typography;

export interface NoticeListProps {
  /** Card 标题；不传则不显示标题（如放在 PageContainer 里时） */
  title?: React.ReactNode;
  /** 每页条数，默认 10 */
  pageSize?: number;
  /** 既読化（全部/批量）后回调，用于刷新外部未读数 */
  onUnreadChange?: () => void;
}

/**
 * 通知一覧（お知らせ）
 *
 * settings 的「お知らせ」tab 与侧栏「通知」落地页共用此组件，
 * 共享同一套 /app/notices 服务层与 notice.* 文案。
 */
const NoticeList: React.FC<NoticeListProps> = ({
  title,
  pageSize = 10,
  onUnreadChange,
}) => {
  const intl = useIntl();
  const [notices, setNotices] = useState<API.Notice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const fetchNotices = useCallback(
    async (p: number) => {
      setLoading(true);
      try {
        const data = await getNotices({ page: p, size: pageSize });
        setNotices(data?.list ?? []);
        setTotal(data?.total ?? 0);
      } catch {
        // 全局 errorConfig 已提示
      } finally {
        setLoading(false);
      }
    },
    [pageSize]
  );

  useEffect(() => {
    fetchNotices(page);
  }, [page, fetchNotices]);

  const handleReadAll = async () => {
    try {
      await markAllNoticesAsRead();
      setNotices((prev) => prev.map((n) => ({ ...n, read: true })));
      setSelectedRowKeys([]);
      onUnreadChange?.();
    } catch {
      // silent
    }
  };

  const handleBatchRead = async () => {
    if (selectedRowKeys.length === 0) return;
    try {
      await batchMarkNoticesAsRead(selectedRowKeys as string[]);
      setNotices((prev) =>
        prev.map((n) =>
          selectedRowKeys.includes(n.id) ? { ...n, read: true } : n
        )
      );
      setSelectedRowKeys([]);
      onUnreadChange?.();
    } catch {
      // silent
    }
  };

  const noticeTypeMap: Record<string, { label: string; color: string }> = {
    NOTICE: {
      label: intl.formatMessage({ id: "notice.type.notice" }),
      color: "default",
    },
    ANNOUNCEMENT: {
      label: intl.formatMessage({ id: "notice.type.announcement" }),
      color: "blue",
    },
  };

  const columns = [
    {
      title: intl.formatMessage({ id: "notice.col.content" }),
      dataIndex: "noticeTitle",
      key: "noticeTitle",
      render: (text: string, record: API.Notice) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!record.read ? (
            <Badge status="processing" />
          ) : (
            <Badge status="default" />
          )}
          <span style={{ fontWeight: record.read ? 400 : 500 }}>{text}</span>
        </div>
      ),
    },
    {
      title: intl.formatMessage({ id: "notice.col.time" }),
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (text: string) =>
        text ? dayjs(text).format("YYYY-MM-DD HH:mm:ss") : "-",
    },
    {
      title: intl.formatMessage({ id: "notice.col.type" }),
      dataIndex: "noticeType",
      key: "noticeType",
      width: 120,
      render: (type: string) => {
        const info = noticeTypeMap[type] || { label: type, color: "default" };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
  ];

  const hasSelected = selectedRowKeys.length > 0;

  return (
    <Card
      title={title}
      variant="borderless"
      style={{ boxShadow: "none" }}
      extra={
        <Space>
          {hasSelected && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              {intl.formatMessage(
                { id: "notice.selected" },
                { count: selectedRowKeys.length }
              )}
            </Text>
          )}
          {hasSelected && (
            <Button size="small" onClick={handleBatchRead}>
              {intl.formatMessage({ id: "notice.markSelectedRead" })}
            </Button>
          )}
          <Button size="small" onClick={handleReadAll}>
            {intl.formatMessage({ id: "notice.readAll" })}
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={notices}
        loading={loading}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        }}
        pagination={{
          current: page,
          pageSize,
          total,
          onChange: (p) => {
            setPage(p);
            setSelectedRowKeys([]);
          },
          size: "small",
          showTotal: (t) =>
            intl.formatMessage({ id: "notice.pagination.total" }, { total: t }),
          showSizeChanger: false,
        }}
        onRow={(record) => ({
          onClick: () => history.push(`/settings/notice/${record.id}`),
          style: { cursor: "pointer" },
        })}
      />
    </Card>
  );
};

export default NoticeList;

import { ArrowLeftOutlined } from "@ant-design/icons";
import { PageContainer } from "@ant-design/pro-components";
import { history, useIntl, useParams } from "@umijs/max";
import { Button, Card, Spin, Tag, Typography } from "antd";
import dayjs from "dayjs";
import React, { useEffect, useState } from "react";
import {
  getNoticeDetail,
  markNoticeAsRead,
} from "@/services/platform/notice";

const { Title, Text, Paragraph } = Typography;

const NoticeDetailPage: React.FC = () => {
  const intl = useIntl();
  const { id } = useParams<{ id: string }>();
  const [notice, setNotice] = useState<API.Notice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getNoticeDetail(id)
      .then((data) => {
        setNotice(data);
        if (data && !data.read) {
          markNoticeAsRead(id).catch(() => {});
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  const noticeTypeLabel =
    notice?.noticeType === "ANNOUNCEMENT"
      ? intl.formatMessage({ id: "notice.type.announcement" })
      : intl.formatMessage({ id: "notice.type.notice" });

  const noticeTypeColor =
    notice?.noticeType === "ANNOUNCEMENT" ? "blue" : "default";

  return (
    <PageContainer
      header={{
        title: intl.formatMessage({ id: "notice.detail.title" }),
        onBack: () => history.push("/notifications"),
      }}
    >
      <Spin spinning={loading}>
        {notice && (
          <Card variant="borderless" style={{ boxShadow: "none" }}>
            <div style={{ maxWidth: 800 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 8,
                }}
              >
                <Title level={4} style={{ margin: 0 }}>
                  {notice.noticeTitle}
                </Title>
                <Tag color={noticeTypeColor}>{noticeTypeLabel}</Tag>
              </div>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {notice.createdAt
                  ? dayjs(notice.createdAt).format("YYYY-MM-DD HH:mm")
                  : ""}
              </Text>
              {notice.noticeContent && (
                <Paragraph
                  style={{
                    marginTop: 24,
                    fontSize: 14,
                    lineHeight: 1.8,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {notice.noticeContent}
                </Paragraph>
              )}
            </div>
          </Card>
        )}
      </Spin>
    </PageContainer>
  );
};

export default NoticeDetailPage;

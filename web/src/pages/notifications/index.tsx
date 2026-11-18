import { PageContainer } from "@ant-design/pro-components";
import { useIntl } from "@umijs/max";
import { Space } from "antd";
import InvitationInbox from "@/components/InvitationInbox";
import NoticeList from "@/components/NoticeList";

/**
 * 通知センター（お知らせ一覧）
 *
 * 侧栏「通知」菜单的落地页。与 settings 的「お知らせ」tab 共用
 * InvitationInbox（邀请同意/拒绝）+ NoticeList（通知一覧）两个组件，
 * 两边完全统一。
 */
export default function NotificationsPage() {
  const intl = useIntl();
  return (
    <PageContainer title={intl.formatMessage({ id: "notifications.title" })}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <InvitationInbox />
        <NoticeList />
      </Space>
    </PageContainer>
  );
}

import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useIntl, useModel } from "@umijs/max";
import { Button, Card, message, Modal, Space } from "antd";
import dayjs from "dayjs";
import React, { useCallback, useEffect, useState } from "react";
import {
  acceptInvitation,
  declineInvitation,
  getInvitationInbox,
} from "@/services/platform/invitation";

export interface InvitationInboxProps {
  /** 接受/拒绝邀请后回调（如刷新通知列表 / 未读数） */
  onChange?: () => void;
}

/**
 * 邀请收件箱（同意/拒绝）
 *
 * 当前账号的待处理团队邀请。无邀请时不渲染任何内容。
 * settings 的「お知らせ」tab 与侧栏「通知」落地页共用此组件。
 */
const InvitationInbox: React.FC<InvitationInboxProps> = ({ onChange }) => {
  const intl = useIntl();
  const { initialState, setInitialState } = useModel("@@initialState");
  const [invitations, setInvitations] = useState<API.Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const fetchInvitations = useCallback(async () => {
    // 没有 email 账号（旧 username 子账号）后端会 403，直接置空避免污染 UI
    if (!initialState?.currentUser?.email) {
      setInvitations([]);
      return;
    }
    setLoading(true);
    try {
      const data = await getInvitationInbox();
      setInvitations(data ?? []);
    } catch {
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [initialState?.currentUser?.email]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  const refreshCurrentUser = async () => {
    const user = await initialState?.fetchUserInfo?.();
    if (user) {
      setInitialState((s) => ({ ...s, currentUser: user }));
    }
  };

  const handleAccept = async (id: string) => {
    setPendingId(id);
    try {
      const result = await acceptInvitation(id);
      message.success(
        intl.formatMessage(
          { id: "invitation.acceptSuccess" },
          { team: result?.tenantName ?? "" }
        )
      );
      await Promise.all([fetchInvitations(), refreshCurrentUser()]);
      onChange?.();
    } catch {
      // error 已由全局 handler 提示
    } finally {
      setPendingId(null);
    }
  };

  const handleDecline = (id: string) => {
    Modal.confirm({
      title: intl.formatMessage({ id: "invitation.declineConfirm" }),
      icon: <ExclamationCircleOutlined />,
      okType: "danger",
      onOk: async () => {
        setPendingId(id);
        try {
          await declineInvitation(id);
          await fetchInvitations();
          onChange?.();
        } finally {
          setPendingId(null);
        }
      },
    });
  };

  if (invitations.length === 0) return null;

  return (
    <Card
      title={intl.formatMessage({ id: "invitation.inbox.title" })}
      variant="borderless"
      style={{ boxShadow: "none" }}
      loading={loading}
    >
      <Space direction="vertical" size="small" style={{ width: "100%" }}>
        {invitations.map((inv) => (
          <div
            key={inv.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 12px",
              border: "1px solid #f0f0f0",
              borderRadius: 6,
              background: "#fafcff",
              gap: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>
                {intl.formatMessage(
                  { id: "invitation.inbox.line" },
                  {
                    inviter: inv.inviterName || "?",
                    team: inv.tenantName || "?",
                  }
                )}
              </div>
              <div style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
                {inv.expiresAt &&
                  intl.formatMessage(
                    { id: "invitation.inbox.expiresAt" },
                    { date: dayjs(inv.expiresAt).format("YYYY-MM-DD") }
                  )}
                {inv.message && <div>{inv.message}</div>}
              </div>
            </div>
            <Space>
              <Button
                size="small"
                onClick={() => handleDecline(inv.id)}
                loading={pendingId === inv.id}
              >
                {intl.formatMessage({ id: "invitation.decline" })}
              </Button>
              <Button
                type="primary"
                size="small"
                onClick={() => handleAccept(inv.id)}
                loading={pendingId === inv.id}
              >
                {intl.formatMessage({ id: "invitation.accept" })}
              </Button>
            </Space>
          </div>
        ))}
      </Space>
    </Card>
  );
};

export default InvitationInbox;

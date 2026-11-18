import { Helmet, history, useIntl, useModel } from "@umijs/max";
import { Button, Card, Result, Space, Spin, Typography, message } from "antd";
import dayjs from "dayjs";
import React, { useCallback, useEffect, useState } from "react";
import {
  acceptInvitationByToken,
  getInvitationByToken,
  type InvitationPreview,
} from "@/services/platform/invitation";

const TOKEN_KEY = "pullcord_token";

/** 从地址栏取邀请 token（深链：/invitations/accept?token=xxx） */
function readToken(): string {
  return new URLSearchParams(window.location.search).get("token") || "";
}

/** 跳转登录并带回本页（登录后 redirect 回来继续接受） */
function gotoLogin(token: string, freshAccount = false) {
  if (freshAccount) {
    // 换账号：先清掉当前登录态，再去登录页
    localStorage.removeItem(TOKEN_KEY);
  }
  const back = `/invitations/accept?token=${encodeURIComponent(token)}`;
  history.push(`/user/login?redirect=${encodeURIComponent(back)}`);
}

/**
 * 邀请邮件深链落地页。
 *
 * 公开预览（凭 token）→ 未登录引导登录 → 登录后校验邮箱一致 → 接受并进入系统。
 * 后端无 token 接受接口以外的鉴权：接受动作仍需登录且当前账号邮箱须等于被邀请邮箱。
 */
const InvitationAcceptPage: React.FC = () => {
  const intl = useIntl();
  const { initialState, setInitialState } = useModel("@@initialState");
  const [token] = useState(readToken);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);

  const currentEmail = initialState?.currentUser?.email?.toLowerCase() || "";
  const loggedIn = !!currentEmail;
  const invitedEmail = (preview?.email || "").toLowerCase();
  const emailMatch = loggedIn && invitedEmail && currentEmail === invitedEmail;

  const load = useCallback(async () => {
    if (!token) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await getInvitationByToken(token);
      setPreview(data ?? null);
      setLoadError(!data);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const result = await acceptInvitationByToken(token);
      message.success(
        intl.formatMessage(
          { id: "invitation.acceptSuccess" },
          { team: result?.tenantName ?? preview?.tenantName ?? "" }
        )
      );
      // 刷新当前用户（新增了租户成员关系），再进入系统
      const user = await initialState?.fetchUserInfo?.();
      if (user) setInitialState((s) => ({ ...s, currentUser: user }));
      history.push("/overview");
    } catch {
      // 全局错误已提示（如 403 邮箱不符 / 400 已处理过期）；刷新预览反映最新状态
      load();
    } finally {
      setAccepting(false);
    }
  };

  const shell = (node: React.ReactNode) => (
    <>
      <Helmet>
        <title>{t("invitation.accept.pageTitle")}</title>
      </Helmet>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f0f2f5",
          padding: 24,
        }}
      >
        <Card style={{ width: 460, maxWidth: "100%" }} variant="borderless">
          {node}
        </Card>
      </div>
    </>
  );

  if (loading) {
    return shell(
      <div style={{ textAlign: "center", padding: "32px 0" }}>
        <Spin />
        <div style={{ marginTop: 12, color: "rgba(0,0,0,0.45)" }}>
          {t("invitation.accept.loading")}
        </div>
      </div>
    );
  }

  if (loadError || !preview) {
    return shell(
      <Result
        status="warning"
        title={t("invitation.accept.invalidTitle")}
        subTitle={t("invitation.accept.invalidDesc")}
        extra={
          <Button type="primary" onClick={() => history.push("/")}>
            {t("invitation.accept.goApp")}
          </Button>
        }
      />
    );
  }

  // 非 pending：已接受 / 已拒绝 / 已撤销 / 已过期
  if (preview.status !== "pending") {
    const map: Record<string, { status: any; title: string; desc: string }> = {
      accepted: {
        status: "success",
        title: t("invitation.accept.acceptedTitle"),
        desc: t("invitation.accept.acceptedDesc"),
      },
      expired: {
        status: "warning",
        title: t("invitation.accept.expiredTitle"),
        desc: t("invitation.accept.expiredDesc"),
      },
      declined: {
        status: "info",
        title: t("invitation.accept.closedTitle"),
        desc: t("invitation.accept.declinedDesc"),
      },
      revoked: {
        status: "info",
        title: t("invitation.accept.closedTitle"),
        desc: t("invitation.accept.revokedDesc"),
      },
    };
    const s = map[preview.status || "expired"] || map.expired;
    return shell(
      <Result
        status={s.status}
        title={s.title}
        subTitle={s.desc}
        extra={
          <Button type="primary" onClick={() => history.push("/")}>
            {t("invitation.accept.goApp")}
          </Button>
        }
      />
    );
  }

  // pending：渲染邀请信息 + 行动按钮
  return shell(
    <div style={{ textAlign: "center" }}>
      <Typography.Title level={4} style={{ marginBottom: 8 }}>
        {t("invitation.accept.pageTitle")}
      </Typography.Title>
      <Typography.Paragraph style={{ fontSize: 15, marginBottom: 4 }}>
        {intl.formatMessage(
          { id: "invitation.inbox.line" },
          {
            inviter: preview.inviterName || "?",
            team: preview.tenantName || "?",
          }
        )}
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {preview.expiresAt &&
          intl.formatMessage(
            { id: "invitation.inbox.expiresAt" },
            { date: dayjs(preview.expiresAt).format("YYYY-MM-DD") }
          )}
      </Typography.Paragraph>
      {preview.message && (
        <Typography.Paragraph
          style={{
            background: "#fafcff",
            border: "1px solid #f0f0f0",
            borderRadius: 6,
            padding: "8px 12px",
            textAlign: "left",
            whiteSpace: "pre-wrap",
          }}
        >
          {preview.message}
        </Typography.Paragraph>
      )}

      <div style={{ marginTop: 16 }}>
        {!loggedIn && (
          <Button type="primary" block onClick={() => gotoLogin(token)}>
            {t("invitation.accept.loginToAccept")}
          </Button>
        )}

        {loggedIn && emailMatch && (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Button
              type="primary"
              block
              loading={accepting}
              onClick={handleAccept}
            >
              {t("invitation.accept")}
            </Button>
            <Button type="link" onClick={() => history.push("/")}>
              {t("invitation.accept.later")}
            </Button>
          </Space>
        )}

        {loggedIn && !emailMatch && (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text type="warning">
              {intl.formatMessage(
                { id: "invitation.accept.mismatchDesc" },
                { invited: preview.email || "", current: currentEmail }
              )}
            </Typography.Text>
            <Button block onClick={() => gotoLogin(token, true)}>
              {t("invitation.accept.switchAccount")}
            </Button>
          </Space>
        )}
      </div>
    </div>
  );
};

export default InvitationAcceptPage;

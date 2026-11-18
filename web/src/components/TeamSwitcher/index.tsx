import { CheckOutlined, DownOutlined, TeamOutlined } from "@ant-design/icons";
import { history, useIntl, useModel } from "@umijs/max";
import { App, Popover, Spin, Tag, Typography } from "antd";
import React, { useState } from "react";
import { flushSync } from "react-dom";
import { switchTeam } from "@/services/platform/invitation";
import { getBootstrapData } from "@/services/platform/bootstrap";

/**
 * 顶部团队切换器。
 *
 * - 仅当 currentUser.availableTeams 长度 ≥ 2 时显示
 * - 切换调 /app/auth/switch-team；成功后刷新 currentUser、订阅、菜单，跳转到 overview
 */
const TeamSwitcher: React.FC = () => {
  const intl = useIntl();
  const { initialState, setInitialState } = useModel("@@initialState");
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const teams = initialState?.currentUser?.availableTeams ?? [];
  if (teams.length < 2) return null;

  const current = teams.find((t) => t.isCurrent) ?? teams[0];

  const handleSwitch = async (tenantUserId: string) => {
    if (loading) return;
    if (tenantUserId === current?.tenantUserId) {
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      await switchTeam(tenantUserId);
      const [user, bootstrap] = await Promise.all([
        initialState?.fetchUserInfo?.(),
        getBootstrapData().catch(() => undefined),
      ]);
      flushSync(() => {
        setInitialState((s) => ({
          ...s,
          currentUser: user ?? s?.currentUser,
          menuTree: bootstrap?.menuTree,
          grantedPermissions: bootstrap?.grantedPermissions,
        }));
      });
      message.success(
        intl.formatMessage(
          { id: "teamSwitcher.switched" },
          {
            team:
              teams.find((t) => t.tenantUserId === tenantUserId)?.tenantName ??
              "",
          }
        )
      );
      setOpen(false);
      history.push("/overview");
    } catch {
      // global error handler
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <Spin spinning={loading}>
      <div style={{ width: 280 }}>
        <div
          style={{
            padding: "8px 12px",
            fontSize: 12,
            color: "rgba(0, 0, 0, 0.45)",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          {intl.formatMessage({ id: "teamSwitcher.title" })}
        </div>
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {teams.map((t) => (
            <div
              key={t.tenantUserId}
              onClick={() => handleSwitch(t.tenantUserId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                cursor: "pointer",
                background: t.isCurrent
                  ? "rgba(22, 119, 255, 0.04)"
                  : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!t.isCurrent) {
                  (e.currentTarget as HTMLElement).style.background = "#fafafa";
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = t.isCurrent
                  ? "rgba(22, 119, 255, 0.04)"
                  : "transparent";
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.tenantName || t.tenantUserId.slice(0, 8)}
                </div>
                <div style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
                  <Tag
                    color={t.role === "owner" ? "gold" : "blue"}
                    style={{ marginInlineEnd: 0, fontSize: 11 }}
                  >
                    {intl.formatMessage({
                      id:
                        t.role === "owner"
                          ? "team.role.owner"
                          : "team.role.member",
                    })}
                  </Tag>
                </div>
              </div>
              {t.isCurrent && (
                <CheckOutlined style={{ color: "#1677ff", fontSize: 14 }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </Spin>
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
      <span
        className="header-action"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          maxWidth: 180,
          overflow: "hidden",
          cursor: "pointer",
        }}
      >
        <TeamOutlined style={{ fontSize: 14 }} />
        <Typography.Text
          style={{
            fontSize: 13,
            maxWidth: 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {current?.tenantName || ""}
        </Typography.Text>
        <DownOutlined style={{ fontSize: 10, color: "rgba(0,0,0,0.45)" }} />
      </span>
    </Popover>
  );
};

export default TeamSwitcher;

import { GlobalOutlined } from "@ant-design/icons";
import { getLocale, setLocale, useIntl, useModel } from "@umijs/max";
import { Select, Space, Tag } from "antd";
import type React from "react";
import { useState } from "react";
import { switchTeam } from "@/services/platform/invitation";

/**
 * 团队切换下拉（从顶部 TeamSwitcher 迁移到「账户设置」内）。
 * 仅当 currentUser.availableTeams 长度 ≥ 2 时显示，否则返回 null。
 * 切换调 /app/auth/switch-team；成功后整页刷新回首页（"/" → /overview），
 * 让所有 React state（含 PM 的 DataProvider 缓存）按新租户重新初始化。
 */
export const TeamSwitchSelect: React.FC = () => {
  const intl = useIntl();
  const { initialState } = useModel("@@initialState");
  const [loading, setLoading] = useState(false);

  const teams = initialState?.currentUser?.availableTeams ?? [];
  if (teams.length < 2) return null;
  const current = teams.find((t) => t.isCurrent) ?? teams[0];

  const handleSwitch = async (tenantUserId: string) => {
    if (loading) return;
    if (tenantUserId === current?.tenantUserId) return;
    setLoading(true);
    try {
      await switchTeam(tenantUserId);
      // 整页刷新回首页（"/" → /overview）。
      // SPA 内遷移だと PM の DataProvider が旧テナントのキャッシュを保持し、
      // ensureBase が baseReq ガードで再取得しないため、新テナントのデータに
      // 切り替わらない。フルリロードで currentUser / 菜单 / PM ストアを作り直す。
      window.location.assign("/");
    } catch {
      // global error handler；失败时恢复可点击
      setLoading(false);
    }
  };

  return (
    <Select
      style={{ width: "100%" }}
      loading={loading}
      value={current?.tenantUserId}
      onChange={handleSwitch}
      optionLabelProp="label"
      options={teams.map((t) => ({
        value: t.tenantUserId,
        label: t.tenantName || t.tenantUserId.slice(0, 8),
        team: t,
      }))}
      optionRender={(opt) => {
        const t = opt.data.team;
        return (
          <Space>
            <span>{t.tenantName || t.tenantUserId.slice(0, 8)}</span>
            <Tag
              color={t.role === "owner" ? "gold" : "blue"}
              style={{ marginInlineEnd: 0, fontSize: 11 }}
            >
              {intl.formatMessage({
                id:
                  t.role === "owner" ? "team.role.owner" : "team.role.member",
              })}
            </Tag>
          </Space>
        );
      }}
    />
  );
};

const LANGS = [
  { key: "en-US", defaultMessage: "English" },
  { key: "ja-JP", defaultMessage: "日本語" },
  { key: "zh-CN", defaultMessage: "简体中文" },
  { key: "zh-TW", defaultMessage: "繁體中文" },
];

/**
 * 语言设置下拉（从顶部语言切换器迁移到「账户设置」内）。
 */
export const LanguageSelect: React.FC = () => {
  const intl = useIntl();
  const current = getLocale();

  const handleSelect = (key: string) => {
    if (key === current) return;
    setLocale(key, false);
  };

  return (
    <Select
      style={{ width: "100%" }}
      value={current}
      onChange={handleSelect}
      suffixIcon={<GlobalOutlined />}
      options={LANGS.map((l) => ({
        value: l.key,
        label: intl.formatMessage({
          id: `lang.${l.key}`,
          defaultMessage: l.defaultMessage,
        }),
      }))}
    />
  );
};

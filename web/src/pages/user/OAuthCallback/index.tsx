import { Helmet, history, useIntl, useModel } from "@umijs/max";
import { Alert, App, Button, Spin } from "antd";
import { createStyles } from "antd-style";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { getBootstrapData } from "@/services/platform/bootstrap";
import Settings from "../../../../config/defaultSettings";

const TOKEN_KEY = "pullcord_token";

const useStyles = createStyles(({ token }) => ({
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    gap: 16,
    background: token.colorBgLayout,
  },
  card: {
    minWidth: 320,
    maxWidth: 480,
    padding: 24,
  },
}));

/**
 * OAuth 登录回调页
 *
 * 后端 /app/auth/oauth/google/callback 会把用户 302 到这里，
 * token 通过 URL fragment（#token=xxx&status=ok）传递。
 * 出错时 fragment 形如 #status=error&reason=xxx。
 */
const OAuthCallback: React.FC = () => {
  const { styles } = useStyles();
  const { initialState, setInitialState } = useModel("@@initialState");
  const { message } = App.useApp();
  const intl = useIntl();
  const [error, setError] = useState<string>("");
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);
    const status = params.get("status");
    const token = params.get("token");
    const reason = params.get("reason");

    const finish = async () => {
      if (status === "error" || !token) {
        setError(reasonToMessage(reason, intl));
        return;
      }

      try {
        localStorage.setItem(TOKEN_KEY, token);
        // 清掉 fragment，避免 token 留在地址栏/历史
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search
        );

        const userInfo = await initialState?.fetchUserInfo?.();
        if (!userInfo) {
          setError(
            intl.formatMessage({
              id: "pages.oauth.fetchUserFailed",
              defaultMessage: "ユーザー情報の取得に失敗しました",
            })
          );
          return;
        }

        const bootstrapData = await getBootstrapData().catch(() => undefined);

        flushSync(() => {
          setInitialState((s) => ({
            ...s,
            currentUser: userInfo,
            menuTree: bootstrapData?.menuTree,
            grantedPermissions: bootstrapData?.grantedPermissions,
          }));
        });

        message.success(
          intl.formatMessage({
            id: "pages.oauth.success",
            defaultMessage: "ログインしました",
          })
        );

        history.push("/overview");
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    };

    void finish();
    // 仅执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.container}>
      <Helmet>
        <title>
          {intl.formatMessage({
            id: "pages.oauth.title",
            defaultMessage: "ログイン処理中",
          })}
          {Settings.title && ` - ${Settings.title}`}
        </title>
      </Helmet>
      <div className={styles.card}>
        {error ? (
          <>
            <Alert type="error" showIcon message={error} />
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <Button
                type="primary"
                onClick={() => history.push("/user/login")}
              >
                {intl.formatMessage({
                  id: "pages.oauth.backToLogin",
                  defaultMessage: "ログイン画面に戻る",
                })}
              </Button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>
              {intl.formatMessage({
                id: "pages.oauth.processing",
                defaultMessage: "ログイン処理中…",
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function reasonToMessage(
  reason: string | null,
  intl: { formatMessage: (o: { id: string; defaultMessage: string }) => string }
): string {
  switch (reason) {
    case "no_code":
    case "bad_state":
      return intl.formatMessage({
        id: "pages.oauth.error.stateMismatch",
        defaultMessage: "認証情報が不正です。もう一度お試しください。",
      });
    case "token_exchange_failed":
    case "userinfo_failed":
    case "userinfo_incomplete":
    case "google_error":
      return intl.formatMessage({
        id: "pages.oauth.error.googleFailed",
        defaultMessage: "Google 認証に失敗しました。もう一度お試しください。",
      });
    case "account_disabled":
      return intl.formatMessage({
        id: "pages.oauth.error.disabled",
        defaultMessage: "アカウントが無効化されています。",
      });
    case "account_closing":
      return intl.formatMessage({
        id: "pages.oauth.error.closing",
        defaultMessage:
          "このアカウントは削除手続き中です。復旧はサポートにお問い合わせください。",
      });
    default:
      return intl.formatMessage({
        id: "pages.oauth.error.generic",
        defaultMessage:
          "ログインに失敗しました。時間を置いてもう一度お試しください。",
      });
  }
}

export default OAuthCallback;

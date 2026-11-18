import { useIntl, useSearchParams } from "@umijs/max";
import { Button, Result } from "antd";
import React from "react";

/**
 * 后端网关不可达（webapi 宕机/重启/502/503/504 或网络异常）时显示的整页。
 * requestErrorConfig.ts 的 errorHandler 在判定为网关错误时会跳到这里，
 * 并把出错前的路径放在 ?redirect= 上，"重试" 即回到原路径。
 */
const ServerErrorPage: React.FC = () => {
  const intl = useIntl();
  const [params] = useSearchParams();
  const redirect = params.get("redirect") || "/";

  // 关键：用整页刷新而非 history.replace。client-side 跳到受保护路径会被 layout
  // 的 onPageChange 以"无 currentUser"为由弹去登录页；整页刷新会重跑 getInitialState，
  // 其中 fetchUserInfo 判定网关不可达后会再回到本页（后端已恢复则正常进入应用）。
  const handleReload = () => {
    window.location.assign(redirect);
  };

  return (
    <Result
      icon={
        <img
          src="/images/502.png"
          alt="502"
          style={{ width: 320, maxWidth: "80vw", margin: "0 auto" }}
        />
      }
      title={intl.formatMessage({ id: "pages.502.title" })}
      subTitle={intl.formatMessage({ id: "pages.502.subTitle" })}
      extra={
        <Button type="primary" onClick={handleReload}>
          {intl.formatMessage({ id: "pages.502.buttonText" })}
        </Button>
      }
    />
  );
};

export default ServerErrorPage;

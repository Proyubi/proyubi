import type { RequestOptions } from "@@/plugin-request/request";
import type { RequestConfig } from "@umijs/max";
import { history } from "@umijs/max";
import { message } from "antd";

const TOKEN_KEY = "pullcord_token";
const loginPath = "/user/login";
const serverErrorPath = "/502";

// 判定是否「后端网关不可达」：边缘 nginx 回 502/503/504，或请求已发出但无任何响应
// （后端宕机 / 网络断）。注意带 skipErrorHandler 的请求（如 getCurrentUser）不会进
// errorHandler，调用方需自行用本判定 + goServerError 处理。
export const isGatewayError = (error: any): boolean => {
  const status = error?.response?.status;
  if (status === 502 || status === 503 || status === 504) return true;
  // 有 request 但无 response = 发出去了却没回（区别于 401/业务错误这类有响应的）
  if (error?.request && !error?.response) return true;
  return false;
};

// 后端网关不可达时跳到整页 502，并把当前路径带在 redirect 上供"重试"返回。已在 502 页则不再跳。
export const goServerError = () => {
  if (window.location.pathname === serverErrorPath) return;
  history.replace({
    pathname: serverErrorPath,
    search: new URLSearchParams({
      redirect: window.location.pathname + window.location.search,
    }).toString(),
  });
};

/**
 * 后端统一响应格式：{ code: 0, msg: "ok", data: T }
 * code === 0 成功，其余为错误码
 */
export const errorConfig: RequestConfig = {
  errorConfig: {
    errorThrower: (res) => {
      const { code, msg, data } = res as any;
      if (typeof code === "number" && code !== 0) {
        const error: any = new Error(msg || "请求失败");
        error.name = "BizError";
        error.info = { code, msg, data };
        throw error;
      }
    },
    errorHandler: (error: any, opts: any) => {
      if (opts?.skipErrorHandler) throw error;

      if (error.name === "BizError") {
        const { code, msg: errorMsg } = error.info || {};
        if (code === 401) {
          localStorage.removeItem(TOKEN_KEY);
          if (window.location.pathname !== loginPath) {
            history.replace({
              pathname: loginPath,
              search: new URLSearchParams({
                redirect: window.location.pathname + window.location.search,
              }).toString(),
            });
          }
          return;
        }
        message.error(errorMsg || "请求失败");
      } else if (error.response) {
        const status = error.response.status;
        if (status === 401) {
          localStorage.removeItem(TOKEN_KEY);
          if (window.location.pathname !== loginPath) {
            history.replace({
              pathname: loginPath,
              search: new URLSearchParams({
                redirect: window.location.pathname + window.location.search,
              }).toString(),
            });
          }
          return;
        }
        // 网关层错误（后端不可达）→ 整页 502，而非一闪而过的 toast
        if (status === 502 || status === 503 || status === 504) {
          goServerError();
          return;
        }
        message.error(`请求错误 ${status}`);
      } else if (error.request) {
        // 请求已发出但无任何响应（后端宕机 / 网络断）→ 同样视为网关不可达
        goServerError();
      } else {
        message.error("请求异常，请重试");
      }
    },
  },

  requestInterceptors: [
    (config: RequestOptions) => {
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) {
        config.headers = {
          ...config.headers,
          satoken: token,
        };
      }
      const locale = localStorage.getItem("umi_locale") || "ja-JP";
      config.headers = {
        ...config.headers,
        "X-Lang": locale,
        "X-App-Code": "pm-web-jp",
        // 告诉后端本前端的公开地址，用于邀请邮件深链（不受 dev 代理 changeOrigin 改写影响）
        "X-App-Base-Url": window.location.origin,
      };
      return config;
    },
  ],

  responseInterceptors: [
    (response: any) => {
      const data = response.data;
      if (data && typeof data.code === "number") {
        // code !== 0 为业务错误。umi 运行时的 errorThrower 仅在 data.success===false
        // 时触发，而后端用的是 {code,msg,data} 没有 success 字段，所以这里手动抛出
        // BizError 交给 errorConfig.errorHandler 处理（否则错误会被静默吞掉）。
        if (data.code !== 0) {
          const error: any = new Error(data.msg || "请求失败");
          error.name = "BizError";
          error.info = { code: data.code, msg: data.msg, data: data.data };
          throw error;
        }
        let inner = data.data;
        // MyBatis-Flex Page 对象转换为前端约定的 { list, total } 格式
        if (
          inner &&
          Array.isArray(inner.records) &&
          typeof inner.totalRow === "number"
        ) {
          inner = { list: inner.records, total: inner.totalRow };
        }
        response.data = inner;
      }
      return response;
    },
  ],
};

import { Helmet, history, useIntl, useModel } from "@umijs/max";
import { Alert, App, Button, Carousel, Form, Input, Segmented } from "antd";
import { createStyles } from "antd-style";
import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { SelectLang } from "@/components";
import {
  loginWithPassword,
  requestEmailCode,
  verifyEmailCode,
} from "@/services/platform/auth";
import { getBootstrapData } from "@/services/platform/bootstrap";
import {
  getTenantBrandingByDomain,
  type PublicTenantBranding,
} from "@/services/platform/publicTenant";
import slide1 from "@/assets/login/slide-1.svg";
import slide2 from "@/assets/login/slide-2.svg";
import slide3 from "@/assets/login/slide-3.svg";
import slide4 from "@/assets/login/slide-4.svg";
import Settings from "../../../../config/defaultSettings";
import { LOGO_URL, LOGO_WHITE_URL } from "@/constants/assets";

const ILLUSTRATIONS = [slide1, slide2, slide3, slide4];
const SLOGAN_KEYS = [
  "pages.login.slogan.1",
  "pages.login.slogan.2",
  "pages.login.slogan.3",
  "pages.login.slogan.4",
] as const;
const SLOGAN_DEFAULTS = [
  "ガントチャートで、全体を俯瞰。",
  "WBSで、タスクを分解。",
  "遅れる前に、リスクを検知。",
  "依存関係も、進捗も、ひと目で。",
];

const TOKEN_KEY = "pullcord_token";
const DEFAULT_LOGO = LOGO_URL;
const RESEND_SECONDS = 60;

const buildLandingUrl = (_intlLocale: string, path: "privacy" | "terms") =>
  `/${path}`;

/** 按邮箱域名给出收件箱跳转 URL；未知 provider 返回 null */
const MAILBOX_PROVIDERS: Array<{
  match: RegExp;
  url: string;
  labelKey: string;
  defaultLabel: string;
}> = [
  {
    match: /@(gmail|googlemail)\.com$/i,
    url: "https://mail.google.com",
    labelKey: "pages.login.openMailbox.gmail",
    defaultLabel: "Gmailを開く ↗",
  },
  {
    match: /@yahoo\.co\.jp$/i,
    url: "https://mail.yahoo.co.jp",
    labelKey: "pages.login.openMailbox.yahooJp",
    defaultLabel: "Yahoo!メールを開く ↗",
  },
  {
    match: /@(yahoo|ymail|rocketmail)\.com$/i,
    url: "https://mail.yahoo.com",
    labelKey: "pages.login.openMailbox.yahoo",
    defaultLabel: "Yahoo Mail を開く ↗",
  },
  {
    match: /@(icloud|me|mac)\.com$/i,
    url: "https://www.icloud.com/mail",
    labelKey: "pages.login.openMailbox.icloud",
    defaultLabel: "iCloud メールを開く ↗",
  },
  {
    match: /@(outlook|hotmail|live|msn)\.com$/i,
    url: "https://outlook.live.com/mail/",
    labelKey: "pages.login.openMailbox.outlook",
    defaultLabel: "Outlook を開く ↗",
  },
];

const resolveMailbox = (email: string) => {
  if (!email) return null;
  return MAILBOX_PROVIDERS.find((p) => p.match.test(email)) ?? null;
};

// Proyubi ロゴの主色（public/logo.svg）に合わせる
const PRIMARY_COLOR = "#2563FF";
const PRIMARY_HOVER = "#1d4fd8";
// 左侧信息面板：logo 的蓝色渐变（public/logo.svg）；表单侧：白底
const INFO_PANEL_BG = "linear-gradient(160deg, #3A8DFF 0%, #2563FF 100%)";
const FORM_BG = "#fff";
const TEXT_COLOR = "#0f2147";
const TEXT_MUTED = "#5b6b8c";
const BORDER_COLOR = "#d9e1ef";
const INFO_PANEL_WIDTH = 550;

const useStyles = createStyles(() => ({
  body: {
    minHeight: "100vh",
    width: "100%",
    background: FORM_BG,
    display: "flex",
    flexDirection: "row",
    overflow: "auto",
    position: "relative",
  },
  langSwitcher: {
    position: "absolute",
    top: 20,
    right: 24,
    zIndex: 10,
    color: TEXT_COLOR,
    "& span": {
      color: TEXT_COLOR,
    },
  },
  imgHolder: {
    width: INFO_PANEL_WIDTH,
    minHeight: "100vh",
    background: INFO_PANEL_BG,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px 50px",
    flexShrink: 0,
    "@media (max-width: 992px)": {
      display: "none",
    },
  },
  infoHolder: {
    maxWidth: 420,
    width: "100%",
    textAlign: "left",
  },
  infoLogo: {
    height: 52,
    width: "auto",
    marginBottom: 36,
  },
  infoTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1.35,
    marginTop: 0,
    marginBottom: 16,
    whiteSpace: "pre-line",
  },
  infoText: {
    color: "#fff",
    fontSize: 15,
    lineHeight: 1.7,
    opacity: 0.85,
    margin: 0,
  },
  carousel: {
    marginTop: 36,
    "& .slick-slide img": {
      display: "block",
      maxWidth: 380,
      width: "100%",
      height: "auto",
      margin: "0 auto",
    },
    "& .slick-dots": {
      bottom: -36,
    },
    "& .slick-dots li button": {
      background: "#fff",
      opacity: 0.4,
      height: 6,
      borderRadius: 3,
    },
    "& .slick-dots li.slick-active button": {
      background: "#fff",
      opacity: 1,
    },
  },
  slideItem: {
    display: "flex !important",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 280,
    gap: 20,
  },
  slideSlogan: {
    color: "#fff",
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.4,
    textAlign: "center",
    margin: 0,
    maxWidth: 380,
    letterSpacing: 0.2,
  },
  formHolder: {
    flex: 1,
    minHeight: "100vh",
    background: FORM_BG,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px 30px",
  },
  formItems: {
    width: "100%",
    maxWidth: 340,
  },
  mobileLogoWrap: {
    display: "none",
    "@media (max-width: 992px)": {
      display: "flex",
      justifyContent: "center",
      marginBottom: 28,
    },
  },
  mobileLogo: {
    height: 44,
    width: "auto",
  },
  pageTitle: {
    color: TEXT_COLOR,
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 24,
    textAlign: "left",
  },
  socialButtons: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginBottom: 16,
  },
  socialButton: {
    height: 48,
    borderRadius: 6,
    border: 0,
    fontSize: 15,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    cursor: "pointer",
    width: "100%",
    transition: "filter 0.2s, box-shadow 0.2s",
    "&:hover, &:focus": {
      boxShadow: "0 5px 6px rgba(0, 0, 0, 0.16) !important",
    },
  },
  socialButtonGoogle: {
    background: "#fff !important",
    color: "#1f1f1f !important",
    border: "1px solid #dadce0 !important",
    "&:hover, &:focus": {
      background: "#f8f9fa !important",
      color: "#1f1f1f !important",
      borderColor: "#dadce0 !important",
    },
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "16px 0",
    color: TEXT_MUTED,
    fontSize: 13,
    "&::before, &::after": {
      content: '""',
      flex: 1,
      height: 1,
      background: BORDER_COLOR,
    },
  },
  methodSwitch: {
    marginBottom: 16,
    background: "#eef2f9",
    "& .ant-segmented-item": {
      color: TEXT_MUTED,
    },
    "& .ant-segmented-item-selected": {
      background: "#fff",
      color: PRIMARY_COLOR,
    },
  },
  alert: {
    marginBottom: 16,
    background: "#fff",
    border: `1px solid ${BORDER_COLOR}`,
    "& .ant-alert-message": { color: TEXT_COLOR },
    "& .ant-alert-icon": { color: PRIMARY_COLOR },
  },
  inputField: {
    height: 48,
    padding: "9px 20px",
    border: `1px solid ${BORDER_COLOR}`,
    background: "#fff",
    color: "#1f1f1f",
    borderRadius: 6,
    fontSize: 15,
    boxShadow: "none",
    "&:hover, &:focus, &.ant-input-affix-wrapper-focused": {
      background: "#fff",
      borderColor: PRIMARY_COLOR,
      boxShadow: "none",
    },
    "& .ant-input": {
      background: "transparent",
      color: "#1f1f1f",
      fontSize: 15,
    },
    "& input::placeholder": {
      color: "#8D8D8D",
    },
    "&::placeholder": {
      color: "#8D8D8D",
    },
    // Chrome 自动填充会给 input 涂淡蓝底（密码框只涂内层，显得割裂），用内阴影盖回白底
    "&:-webkit-autofill, & input:-webkit-autofill": {
      WebkitBoxShadow: "0 0 0 1000px #fff inset",
      WebkitTextFillColor: "#1f1f1f",
      caretColor: "#1f1f1f",
      transition: "background-color 9999s ease-out 0s",
    },
  },
  primaryBtn: {
    height: 48,
    width: "100%",
    background: PRIMARY_COLOR,
    color: "#fff",
    fontWeight: 700,
    fontSize: 15,
    borderRadius: 6,
    border: 0,
    boxShadow: "0 0 0 rgba(0, 0, 0, 0.16)",
    transition: "box-shadow 0.2s",
    "&:hover, &:focus": {
      background: `${PRIMARY_HOVER} !important`,
      color: "#fff !important",
      boxShadow: "0 5px 6px rgba(0, 0, 0, 0.16) !important",
      borderColor: "transparent !important",
    },
    "&[disabled], &[disabled]:hover": {
      background: "#c7d6f5 !important",
      color: "#fff !important",
    },
  },
  resentTip: {
    marginTop: 8,
    color: TEXT_MUTED,
    fontSize: 13,
    textAlign: "center",
  },
  resendLink: {
    color: PRIMARY_COLOR,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "underline",
    "&:hover": { opacity: 0.85 },
  },
  changeEmail: {
    marginTop: 12,
    fontSize: 13,
    textAlign: "center",
    color: TEXT_MUTED,
    cursor: "pointer",
    "&:hover": { color: PRIMARY_COLOR, textDecoration: "underline" },
  },
  hint: {
    marginTop: 16,
    fontSize: 12,
    lineHeight: 1.6,
    color: TEXT_MUTED,
    textAlign: "center",
    "& a": {
      color: PRIMARY_COLOR,
      textDecoration: "underline",
      "&:hover": { opacity: 0.85 },
    },
  },
  mailboxLink: {
    marginTop: 8,
    marginBottom: 16,
    fontSize: 13,
    textAlign: "center",
    "& a": {
      color: PRIMARY_COLOR,
      textDecoration: "underline",
      "&:hover": { opacity: 0.85 },
    },
  },
  codeIntro: {
    color: TEXT_COLOR,
    fontSize: 14,
    marginBottom: 8,
    textAlign: "center",
  },
  emailHighlight: {
    display: "block",
    marginTop: 4,
    color: TEXT_COLOR,
    fontWeight: 600,
    wordBreak: "break-all",
  },
}));

type Step = "email" | "code";
type LoginMethod = "email" | "password";

const Login: React.FC = () => {
  const [error, setError] = useState<string>("");
  const [branding, setBranding] = useState<PublicTenantBranding | null>(null);
  const [step, setStep] = useState<Step>("email");
  const [method, setMethod] = useState<LoginMethod>("email");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { initialState, setInitialState } = useModel("@@initialState");
  const { styles, cx } = useStyles();
  const { message } = App.useApp();
  const intl = useIntl();
  const [emailForm] = Form.useForm();
  const [codeForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  useEffect(() => {
    let cancelled = false;
    const host = window.location.hostname;
    if (!host) return;
    getTenantBrandingByDomain(host)
      .then((res) => {
        if (!cancelled && res) setBranding(res);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_SECONDS);
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const fetchUserInfo = async () => {
    const userInfo = await initialState?.fetchUserInfo?.();
    if (userInfo) {
      const bootstrapData = await getBootstrapData().catch(() => undefined);
      flushSync(() => {
        setInitialState((s) => ({
          ...s,
          currentUser: userInfo,
          menuTree: bootstrapData?.menuTree,
          grantedPermissions: bootstrapData?.grantedPermissions,
        }));
      });
    }
  };

  const handleGoogleLogin = () => {
    const redirect = `${window.location.origin}/oauth/callback`;
    // 浏览器地址栏跳转，不走 axios，所以要手动带上 API_BASE_URL（prod=/api，dev=空）
    const apiBase = process.env.API_BASE_URL || "";
    window.location.href = `${apiBase}/app/auth/oauth/google/start?redirect=${encodeURIComponent(
      redirect
    )}`;
  };

  const handleSendCode = async (values: { email: string }) => {
    try {
      setError("");
      setSending(true);
      await requestEmailCode({ email: values.email });
      setEmail(values.email);
      setStep("code");
      startCooldown();
      message.success(
        intl.formatMessage({
          id: "pages.login.code.sent",
          defaultMessage: "認証コードを送信しました",
        })
      );
    } catch (err: any) {
      setError(
        err?.message ||
          intl.formatMessage({
            id: "pages.login.code.sendFailed",
            defaultMessage: "認証コードの送信に失敗しました",
          })
      );
    } finally {
      setSending(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    await handleSendCode({ email });
  };

  const handleVerify = async (values: { code: string }) => {
    try {
      setError("");
      setVerifying(true);
      const result = await verifyEmailCode({ email, code: values.code });
      if (result?.token) {
        localStorage.setItem(TOKEN_KEY, result.token);
        message.success(
          intl.formatMessage({
            id: "pages.login.success",
            defaultMessage: "ログイン成功",
          })
        );
        await fetchUserInfo();
        const urlParams = new URL(window.location.href).searchParams;
        history.push(urlParams.get("redirect") || "/");
      }
    } catch (err: any) {
      setError(
        err?.message ||
          intl.formatMessage({
            id: "pages.login.failure",
            defaultMessage: "ログイン失敗。もう一度お試しください",
          })
      );
    } finally {
      setVerifying(false);
    }
  };

  const handlePasswordLogin = async (values: {
    username: string;
    password: string;
  }) => {
    try {
      setError("");
      setLoggingIn(true);
      const result = await loginWithPassword({
        username: values.username,
        password: values.password,
      });
      if (result?.token) {
        localStorage.setItem(TOKEN_KEY, result.token);
        message.success(
          intl.formatMessage({
            id: "pages.login.success",
            defaultMessage: "ログイン成功",
          })
        );
        await fetchUserInfo();
        const urlParams = new URL(window.location.href).searchParams;
        history.push(urlParams.get("redirect") || "/");
      }
    } catch (err: any) {
      setError(
        err?.message ||
          intl.formatMessage({
            id: "pages.login.failure",
            defaultMessage: "ログイン失敗。もう一度お試しください",
          })
      );
    } finally {
      setLoggingIn(false);
    }
  };

  const handleChangeEmail = () => {
    setStep("email");
    setError("");
    codeForm.resetFields();
  };

  const logoSrc = branding?.loginLogoUrl || DEFAULT_LOGO;
  const heroTitle =
    branding?.loginTitle ||
    intl.formatMessage({
      id: "pages.login.heroTitle",
      defaultMessage: "プロジェクトを、見える化する。\n遅れを、止める。",
    });
  const heroSubtitle =
    branding?.loginSubtitle ||
    intl.formatMessage({
      id: "pages.login.heroSubtitle",
      defaultMessage:
        "ガント・WBSで進捗をひと目で把握。遅延・ブロック・期限間近のリスクを先回りで検知し、チーム全体の状況を一画面で。",
    });

  const pageTitle = intl.formatMessage({
    id: "pages.login.pageTitle",
    defaultMessage: "ログイン / 新規登録",
  });

  return (
    <>
      <Helmet>
        <title>
          {pageTitle}
          {Settings.title && ` - ${Settings.title}`}
        </title>
      </Helmet>
      <div className={styles.body}>
        <div className={styles.langSwitcher}>
          <SelectLang />
        </div>
        <div className={styles.imgHolder}>
          <div className={styles.infoHolder}>
            <img
              src={branding?.loginLogoUrl || LOGO_WHITE_URL}
              alt={Settings.title || "Proyubi"}
              className={styles.infoLogo}
            />
            <h3 className={styles.infoTitle}>{heroTitle}</h3>
            <p className={styles.infoText}>{heroSubtitle}</p>
            <Carousel
              autoplay
              autoplaySpeed={4000}
              dots
              effect="fade"
              pauseOnHover
              className={styles.carousel}
            >
              {ILLUSTRATIONS.map((src, i) => (
                <div key={src} className={styles.slideItem}>
                  <img src={src} alt={`illustration-${i + 1}`} />
                  <p className={styles.slideSlogan}>
                    {intl.formatMessage({
                      id: SLOGAN_KEYS[i],
                      defaultMessage: SLOGAN_DEFAULTS[i],
                    })}
                  </p>
                </div>
              ))}
            </Carousel>
          </div>
        </div>

        <div className={styles.formHolder}>
          <div className={styles.formItems}>
            <div className={styles.mobileLogoWrap}>
              <img
                src={logoSrc}
                alt={Settings.title || "Proyubi"}
                className={styles.mobileLogo}
              />
            </div>

            <div className={styles.pageTitle}>{pageTitle}</div>

            {error && (
              <Alert
                className={styles.alert}
                message={error}
                type="error"
                showIcon
              />
            )}

            {step === "email" && (
              <>
                <div className={styles.socialButtons}>
                  <Button
                    className={cx(
                      styles.socialButton,
                      styles.socialButtonGoogle
                    )}
                    onClick={handleGoogleLogin}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.5 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H1.84C1.09 8.55.66 10.22.66 12s.43 3.45 1.18 4.93l3.66-2.84z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                    }
                  >
                    {intl.formatMessage({
                      id: "pages.login.google",
                      defaultMessage: "Googleで続ける",
                    })}
                  </Button>
                </div>

                <div className={styles.divider}>
                  {intl.formatMessage({
                    id: "pages.login.or",
                    defaultMessage: "または",
                  })}
                </div>

                <Segmented<LoginMethod>
                  block
                  className={styles.methodSwitch}
                  value={method}
                  onChange={(val) => {
                    setMethod(val);
                    setError("");
                  }}
                  options={[
                    {
                      label: intl.formatMessage({
                        id: "pages.login.method.email",
                        defaultMessage: "メール",
                      }),
                      value: "email",
                    },
                    {
                      label: intl.formatMessage({
                        id: "pages.login.method.password",
                        defaultMessage: "ユーザー名・パスワード",
                      }),
                      value: "password",
                    },
                  ]}
                />

                {method === "email" && (
                  <Form
                    form={emailForm}
                    layout="vertical"
                    requiredMark={false}
                    onFinish={handleSendCode}
                  >
                    <Form.Item
                      name="email"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: "pages.login.email.required",
                            defaultMessage: "メールアドレスを入力してください",
                          }),
                        },
                        {
                          type: "email",
                          message: intl.formatMessage({
                            id: "pages.login.email.invalid",
                            defaultMessage:
                              "有効なメールアドレスを入力してください",
                          }),
                        },
                      ]}
                    >
                      <Input
                        type="email"
                        autoComplete="email"
                        className={styles.inputField}
                        placeholder={intl.formatMessage({
                          id: "pages.login.email.placeholder",
                          defaultMessage: "メールアドレス",
                        })}
                      />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0 }}>
                      <Button
                        htmlType="submit"
                        className={styles.primaryBtn}
                        loading={sending}
                      >
                        {intl.formatMessage({
                          id: "pages.login.code.send",
                          defaultMessage: "メールで続ける",
                        })}
                      </Button>
                    </Form.Item>
                  </Form>
                )}

                {method === "password" && (
                  <Form
                    form={passwordForm}
                    layout="vertical"
                    requiredMark={false}
                    onFinish={handlePasswordLogin}
                  >
                    <Form.Item
                      name="username"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: "pages.login.username.required",
                            defaultMessage: "ユーザー名を入力してください",
                          }),
                        },
                      ]}
                    >
                      <Input
                        autoComplete="username"
                        className={styles.inputField}
                        placeholder={intl.formatMessage({
                          id: "pages.login.username.placeholder",
                          defaultMessage: "ユーザー名",
                        })}
                      />
                    </Form.Item>
                    <Form.Item
                      name="password"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: "pages.login.password.required",
                            defaultMessage: "パスワードを入力してください",
                          }),
                        },
                      ]}
                    >
                      <Input.Password
                        autoComplete="current-password"
                        className={styles.inputField}
                        placeholder={intl.formatMessage({
                          id: "pages.login.password.placeholder",
                          defaultMessage: "パスワード",
                        })}
                      />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0 }}>
                      <Button
                        htmlType="submit"
                        className={styles.primaryBtn}
                        loading={loggingIn}
                      >
                        {intl.formatMessage({
                          id: "pages.login.password.submit",
                          defaultMessage: "ログイン",
                        })}
                      </Button>
                    </Form.Item>
                  </Form>
                )}

                <div className={styles.hint}>
                  {intl.formatMessage(
                    {
                      id: "pages.login.privacy",
                      defaultMessage:
                        "続行することで、<terms>利用規約</terms>と<privacy>プライバシーポリシー</privacy>に同意したものとみなされます。",
                    },
                    {
                      terms: (chunks: React.ReactNode) => (
                        <a
                          href={buildLandingUrl(intl.locale, "terms")}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {chunks}
                        </a>
                      ),
                      privacy: (chunks: React.ReactNode) => (
                        <a
                          href={buildLandingUrl(intl.locale, "privacy")}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {chunks}
                        </a>
                      ),
                    }
                  )}
                </div>
              </>
            )}

            {step === "code" && (
              <Form
                form={codeForm}
                layout="vertical"
                requiredMark={false}
                onFinish={handleVerify}
              >
                <div className={styles.codeIntro}>
                  {intl.formatMessage(
                    {
                      id: "pages.login.code.sentTo",
                      defaultMessage:
                        "以下に送信された認証コードを入力してください：{email}",
                    },
                    {
                      email: (
                        <span className={styles.emailHighlight}>{email}</span>
                      ),
                    }
                  )}
                </div>
                {(() => {
                  const mailbox = resolveMailbox(email);
                  if (!mailbox) return null;
                  return (
                    <div className={styles.mailboxLink}>
                      <a
                        href={mailbox.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {intl.formatMessage({
                          id: mailbox.labelKey,
                          defaultMessage: mailbox.defaultLabel,
                        })}
                      </a>
                    </div>
                  );
                })()}
                <Form.Item
                  name="code"
                  rules={[
                    {
                      required: true,
                      message: intl.formatMessage({
                        id: "pages.login.code.required",
                        defaultMessage: "認証コードを入力してください",
                      }),
                    },
                    {
                      pattern: /^\d{6}$/,
                      message: intl.formatMessage({
                        id: "pages.login.code.invalid",
                        defaultMessage: "6桁の数字を入力してください",
                      }),
                    },
                  ]}
                >
                  <Input
                    className={styles.inputField}
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder={intl.formatMessage({
                      id: "pages.login.code.placeholder",
                      defaultMessage: "6桁の認証コード",
                    })}
                  />
                </Form.Item>
                <Form.Item style={{ marginBottom: 0 }}>
                  <Button
                    htmlType="submit"
                    className={styles.primaryBtn}
                    loading={verifying}
                  >
                    {intl.formatMessage({
                      id: "pages.login.continue",
                      defaultMessage: "続ける",
                    })}
                  </Button>
                </Form.Item>
                <div className={styles.resentTip}>
                  {cooldown > 0 ? (
                    intl.formatMessage(
                      {
                        id: "pages.login.code.resendIn",
                        defaultMessage: "{seconds}秒後に再送信できます",
                      },
                      { seconds: cooldown }
                    )
                  ) : (
                    <span className={styles.resendLink} onClick={handleResend}>
                      {intl.formatMessage({
                        id: "pages.login.code.resend",
                        defaultMessage: "認証コードを再送信",
                      })}
                    </span>
                  )}
                </div>
                <div className={styles.changeEmail} onClick={handleChangeEmail}>
                  {intl.formatMessage({
                    id: "pages.login.changeEmail",
                    defaultMessage: "← メールアドレスを変更",
                  })}
                </div>
              </Form>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Login;

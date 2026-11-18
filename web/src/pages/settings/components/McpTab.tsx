import { ReloadOutlined } from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import {
  Alert,
  Button,
  Card,
  Collapse,
  Popconfirm,
  Space,
  Spin,
  Steps,
  Typography,
  message,
} from "antd";
import { useEffect, useState } from "react";
import {
  type McpConnection,
  getMcpConnection,
  regenerateMcpConnection,
} from "@/services/platform/mcp";

const { Paragraph, Text } = Typography;

/**
 * 「設定 → MCP設定」タブ。
 * ログインユーザー本人の MCP 連携 URL（個人トークン内蔵）を表示し、
 * ChatGPT / Claude への登録手順を簡潔に案内する。URL は個人の鍵なので本人にしか出さない。
 */
const McpTab: React.FC = () => {
  const intl = useIntl();
  const t = (id: string, defaultMessage: string) =>
    intl.formatMessage({ id, defaultMessage });

  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState<McpConnection | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * 表示する MCP 接続 URL。
   *
   * MCP サーバは **専用サブドメイン** （例 `mcp.example.com`）（エッジが pm-mcp
   * コンテナ :3110 へ直接反代）で配信する。URL の基址はバックエンドの
   * `proyubi.pm.mcp.base-url`（＝ conn.url = {base}/t/{token}/mcp）が唯一の正。
   * かつては web と同一オリジンの `/mcp/...` を組み立てていたが、専用サブドメインに
   * 切り替えたのでバックエンドが払い出す url をそのまま表示する。
   */
  const mcpUrl = conn?.url ?? "";

  useEffect(() => {
    setLoading(true);
    getMcpConnection()
      .then((data) => setConn(data))
      .catch(() => {
        /* global handler shows the error */
      })
      .finally(() => setLoading(false));
  }, []);

  const handleRegenerate = async () => {
    setBusy(true);
    try {
      const data = await regenerateMcpConnection();
      setConn(data);
      message.success(
        t("settings.mcp.regenerated", "新しい URL を発行しました")
      );
    } catch {
      /* handled globally */
    } finally {
      setBusy(false);
    }
  };

  const chatgptSteps = [
    t(
      "settings.mcp.cg1",
      "設定 → コネクタ → 詳細設定 で「開発者モード」を ON にする"
    ),
    t(
      "settings.mcp.cg2",
      "「カスタムコネクタを追加」→ 上の URL を貼り付け（認証：なし）"
    ),
    t("settings.mcp.cg3", "チャットで「PM アシスタント」を選んで話しかける"),
  ];
  const claudeSteps = [
    t(
      "settings.mcp.cl1",
      "設定 → コネクタ を開く（「開発者 / ローカル MCP」ではありません）"
    ),
    t("settings.mcp.cl2", "「カスタムコネクタを追加」→ 上の URL を貼り付け"),
    t(
      "settings.mcp.cl3",
      "チャットで「PM アシスタント」を有効にして話しかける"
    ),
  ];

  const stepList = (steps: string[]) => (
    <Steps
      direction="vertical"
      size="small"
      current={-1}
      items={steps.map((s) => ({ title: s }))}
      style={{ marginTop: 4 }}
    />
  );

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card
        variant="borderless"
        style={{ boxShadow: "none" }}
        title={t("settings.mcp.title", "AI アシスタント連携（MCP）")}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Text type="secondary">
            {t(
              "settings.mcp.intro",
              "この URL をあなたの ChatGPT / Claude に登録すると、チャットで話しかけるだけでこの PM システムを操作できます（タスクの閲覧・作成・更新など）。"
            )}
          </Text>

          <Spin spinning={loading}>
            {conn && (
              <div>
                <Text strong>
                  {t("settings.mcp.urlLabel", "あなた専用の接続 URL")}
                </Text>
                <Paragraph
                  copyable={{ text: mcpUrl }}
                  code
                  style={{
                    marginTop: 8,
                    padding: "8px 12px",
                    background: "rgba(0,0,0,0.03)",
                    borderRadius: 6,
                    wordBreak: "break-all",
                  }}
                >
                  {mcpUrl}
                </Paragraph>
                <Space>
                  <Popconfirm
                    title={t(
                      "settings.mcp.regenerateConfirm",
                      "再発行すると今の URL は使えなくなります。よろしいですか？"
                    )}
                    onConfirm={handleRegenerate}
                    okButtonProps={{ loading: busy }}
                  >
                    <Button size="small" icon={<ReloadOutlined />} danger>
                      {t("settings.mcp.regenerate", "URL を再発行")}
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
            )}
          </Spin>

          <Alert
            type="warning"
            showIcon
            message={t(
              "settings.mcp.warning",
              "この URL はあなた個人の鍵です。他人に共有しないでください。漏れた場合は「URL を再発行」で無効化できます。"
            )}
          />
        </Space>
      </Card>

      <Card
        variant="borderless"
        style={{ boxShadow: "none" }}
        title={t("settings.mcp.setupTitle", "設定方法")}
      >
        <Collapse
          defaultActiveKey={["claude"]}
          items={[
            {
              key: "claude",
              label: t("settings.mcp.claudeTitle", "Claude に登録する"),
              children: stepList(claudeSteps),
            },
            {
              key: "chatgpt",
              label: t("settings.mcp.chatgptTitle", "ChatGPT に登録する"),
              children: stepList(chatgptSteps),
            },
          ]}
        />
        <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
          {t(
            "settings.mcp.example",
            "例：「〇〇プロジェクトの遅れているタスクを教えて」「この要件をタスクに分解して登録して」"
          )}
        </Text>
      </Card>
    </Space>
  );
};

export default McpTab;

import {
  EditOutlined,
  ExportOutlined,
  FolderAddOutlined,
} from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import { Button, Popconfirm } from "antd";
import type React from "react";
import type { PmDoc } from "../types";
import DocIcon, { DocProviderLabel, useDocName } from "./DocIcon";
import "./docs.css";

interface Props {
  /** 顧客ルート or 案件フォルダ */
  level: "customer" | "project";
  root?: PmDoc | null;
  onSet: () => void;
  onRemove: () => void;
  /** banner：顧客ドロワー上部の細い横帯（パス + 説明 + テキストリンク）。既定は card */
  variant?: "card" | "banner";
}

/** ルートフォルダ（顧客ルート / 案件フォルダ）のカード。未設定なら設定を促す。 */
export default function DocRootCard({
  level,
  root,
  onSet,
  onRemove,
  variant = "card",
}: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const docName = useDocName();

  if (!root) {
    return (
      <div className="pm-doc-root is-unset">
        <DocIcon doc={{ kind: "gfolder", title: null, url: "" }} size={36} />
        <div className="pm-doc-root-body">
          <div className="pm-doc-root-label">
            {t(
              level === "customer"
                ? "docs.root.unsetCustomer"
                : "docs.root.unsetProject"
            )}
          </div>
          <div className="pm-doc-root-sub">{t("docs.root.unsetHint")}</div>
        </div>
        <Button icon={<FolderAddOutlined />} onClick={onSet}>
          {t("docs.root.set")}
        </Button>
      </div>
    );
  }

  const name = docName(root);
  const removeConfirm = (trigger: React.ReactNode) => (
    <Popconfirm
      title={t("docs.root.removeConfirm")}
      description={t("docs.deleteConfirm.desc")}
      okText={t("docs.root.remove")}
      okButtonProps={{ danger: true }}
      cancelText={t("common.cancel")}
      onConfirm={onRemove}
    >
      {trigger}
    </Popconfirm>
  );

  if (variant === "banner") {
    const provider = ["google", "microsoft", "box"].includes(root.provider)
      ? root.provider
      : "other";
    return (
      <div className="pm-doc-root is-banner">
        <DocIcon doc={root} size={32} />
        <div className="pm-doc-root-body">
          <div className="pm-doc-root-path" title={name}>
            <b>
              {t(
                level === "customer"
                  ? "docs.root.customer"
                  : "docs.root.project"
              )}
              ：
            </b>
            {t(`docs.provider.${provider}`)} › {name}
          </div>
          <div className="pm-doc-root-sub">{t("docs.root.bannerHint")}</div>
        </div>
        <div className="pm-doc-root-links">
          <Button type="link" size="small" onClick={onSet}>
            {t("docs.root.change")}
          </Button>
          {removeConfirm(
            <Button type="link" size="small" danger>
              {t("docs.root.remove")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pm-doc-root">
      <DocIcon doc={root} size={36} />
      <div className="pm-doc-root-body">
        <div className="pm-doc-root-caption">
          {t(level === "customer" ? "docs.root.customer" : "docs.root.project")}
        </div>
        <div className="pm-doc-root-label" title={name}>
          {name}
        </div>
        <div className="pm-doc-root-sub">
          <DocProviderLabel provider={root.provider} />
        </div>
      </div>
      <div className="pm-doc-root-actions">
        <Button
          size="small"
          icon={<ExportOutlined />}
          href={root.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t("docs.open")}
        </Button>
        <Button size="small" icon={<EditOutlined />} onClick={onSet}>
          {t("docs.root.change")}
        </Button>
        {removeConfirm(
          <Button size="small" type="text" danger>
            {t("docs.root.remove")}
          </Button>
        )}
      </div>
    </div>
  );
}

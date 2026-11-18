import { FolderFilled, LinkOutlined } from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import { useCallback } from "react";
import {
  type DocFileType,
  type DocNameSource,
  type DocTypeSource,
  docDisplayName,
  docFileType,
} from "../utils/doc";
import "./docs.css";

const LABEL: Record<DocFileType, string> = {
  pdf: "PDF",
  xls: "XLS",
  doc: "DOC",
  ppt: "PPT",
  img: "IMG",
  folder: "",
  file: "FILE",
  link: "",
};

interface IconProps {
  doc: DocTypeSource;
  /** 方块の一辺（px）。既定 28 */
  size?: number;
}

/**
 * 資料の種類アイコン（色付きの角丸方块）。PDF=赤 / XLS=緑 / DOC=青 / PPT=橙 / IMG=紫 / フォルダ=黄 / リンク=灰。
 * 色は docs.css の .pm-doc-icon.is-<type>。
 */
export default function DocIcon({ doc, size = 28 }: IconProps) {
  const type = docFileType(doc);
  const label = LABEL[type];
  return (
    <span
      className={`pm-doc-icon is-${type}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.32)),
      }}
      aria-hidden
    >
      {type === "folder" ? (
        <FolderFilled style={{ fontSize: Math.round(size * 0.55) }} />
      ) : type === "link" ? (
        <LinkOutlined style={{ fontSize: Math.round(size * 0.5) }} />
      ) : (
        label
      )}
    </span>
  );
}

/** 保存先ラベル：色ドット + 「Google ドライブ / SharePoint / Box / リンク」。 */
export function DocProviderLabel({ provider }: { provider: string }) {
  const intl = useIntl();
  const p = ["google", "microsoft", "box"].includes(provider)
    ? provider
    : "other";
  return (
    <span className={`pm-doc-provider is-${p}`}>
      <span className="pm-doc-provider-dot" />
      {intl.formatMessage({ id: `docs.provider.${p}` })}
    </span>
  );
}

/** kind の表示名（「Google スプレッドシート」等）。gfile/ms/box は拡張子が分かればその種類名を優先。 */
export function useDocKindLabel() {
  const intl = useIntl();
  return (doc: DocTypeSource) => {
    const kind = [
      "gdoc",
      "gsheet",
      "gslide",
      "gfile",
      "gfolder",
      "ms",
      "box",
      "link",
    ].includes(doc.kind)
      ? doc.kind
      : "link";
    if (kind === "gfile" || kind === "ms" || kind === "box") {
      const type = docFileType(doc);
      if (type !== "file" && type !== "link")
        return intl.formatMessage({ id: `docs.type.${type}` });
    }
    return intl.formatMessage({ id: `docs.kind.${kind}` });
  };
}

/**
 * 表示名の関数（title → ファイル名 → provider 別の既定名 → ホスト名）。
 * 「Google ドライブのフォルダ」等の既定名を i18n で引くため、画面ではこちらを使う。
 */
export function useDocName() {
  const intl = useIntl();
  return useCallback(
    (doc: DocNameSource) =>
      docDisplayName(doc, (id) => intl.formatMessage({ id })),
    [intl]
  );
}

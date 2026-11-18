import { ExportOutlined, FileSearchOutlined } from "@ant-design/icons";
import { useIntl } from "@umijs/max";
import { Button } from "antd";
import type { PmDoc } from "../types";
import DocIcon, {
  DocProviderLabel,
  useDocKindLabel,
  useDocName,
} from "./DocIcon";
import "./docs.css";

interface Props {
  /** 未選択なら案内だけを出す */
  doc?: PmDoc | null;
  /**
   * フォルダを表示しているとき「右上の資料を追加から登録すると、ここでプレビューできる」案内を出す。
   * フォルダの埋め込みビューは中のファイルをここでプレビューできない（クリックは新しいタブ）。
   * 追加の入口はヘッダーの「資料を追加」1 か所だけにするので、ここにはボタンを置かない。
   */
  folderHint?: boolean;
}

/**
 * 資料プレビュー。previewUrl があれば網盘公式の埋め込み URL を iframe で表示し、
 * 無ければ（SharePoint / Box / 一般リンク / id が取れない Google URL）兜底カードを出す。
 * 権限はドライブ側の共有設定のまま。表示できないケースは利用者に原因と「新しいタブで開く」を常に示す。
 */
export default function DocPreview({ doc, folderHint }: Props) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const kindLabel = useDocKindLabel();
  const docName = useDocName();

  if (!doc) {
    return (
      <div className="pm-doc-preview is-empty">
        <FileSearchOutlined className="pm-doc-preview-empty-ico" />
        <span>{t("docs.selectToPreview")}</span>
      </div>
    );
  }

  const name = docName(doc);
  const openBtn = (primary?: boolean) => (
    <Button
      type={primary ? "primary" : "default"}
      size={primary ? "middle" : "small"}
      icon={<ExportOutlined />}
      href={doc.url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {t("docs.open")}
    </Button>
  );

  const isFolder = doc.kind === "gfolder" && !!doc.externalId;
  const providerKey = ["google", "microsoft", "box"].includes(doc.provider)
    ? doc.provider
    : "other";

  return (
    <div className="pm-doc-preview">
      <div className="pm-doc-preview-head">
        <DocIcon doc={doc} size={30} />
        <div className="pm-doc-preview-titles">
          <div className="pm-doc-preview-name" title={name}>
            {name}
          </div>
          <div className="pm-doc-preview-meta">
            <DocProviderLabel provider={doc.provider} />
            <span className="pm-doc-sep">·</span>
            <span>{kindLabel(doc)}</span>
            {doc.createdByName && (
              <>
                <span className="pm-doc-sep">·</span>
                <span>{t("docs.addedBy", { name: doc.createdByName })}</span>
              </>
            )}
          </div>
        </div>
        {openBtn()}
      </div>

      {doc.previewUrl ? (
        <>
          <iframe
            key={doc.id}
            className="pm-doc-preview-frame"
            title={name}
            src={doc.previewUrl}
            allow="fullscreen"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
          {isFolder && folderHint ? (
            <div className="pm-doc-preview-folderbar">
              {t("docs.folder.registerHint")}
            </div>
          ) : (
            <div className="pm-doc-preview-hint">
              {t("docs.preview.hint")}
              <a href={doc.url} target="_blank" rel="noreferrer noopener">
                {t("docs.open")}
              </a>
            </div>
          )}
        </>
      ) : (
        <div className="pm-doc-fallback">
          <div className="pm-doc-fallback-card">
            <DocIcon doc={doc} size={56} />
            <div className="pm-doc-fallback-name" title={name}>
              {name}
            </div>
            <div className="pm-doc-fallback-title">
              {t("docs.fallback.title")}
            </div>
            <div className="pm-doc-fallback-desc">
              {t(`docs.fallback.${providerKey}`)}
            </div>
            {openBtn(true)}
            <div className="pm-doc-fallback-url" title={doc.url}>
              {doc.url}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

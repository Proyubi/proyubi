import type {
  BatchDocItem,
  DocKind,
  DocProvider,
  PmDoc,
  Task,
} from "../types";

/**
 * 資料（pm_doc）まわりの純粋ロジック。UI から切り離して Jest で検証する。
 * 設計：doc/design/pm-drive-docs.md §3 / §5
 */

// ===================== URL ヒント（入力中の表示専用。正は後端の判定） =====================

export interface DocUrlHint {
  provider: DocProvider;
  kind: DocKind;
  /** 埋め込みプレビューが出せる見込みか（google で id が取れた場合のみ） */
  previewable: boolean;
}

const GOOGLE_ID = "([A-Za-z0-9_-]+)";

const GOOGLE_PATTERNS: { kind: DocKind; re: RegExp }[] = [
  { kind: "gdoc", re: new RegExp(`^/document/d/${GOOGLE_ID}`) },
  { kind: "gsheet", re: new RegExp(`^/spreadsheets/d/${GOOGLE_ID}`) },
  { kind: "gslide", re: new RegExp(`^/presentation/d/${GOOGLE_ID}`) },
];

/**
 * URL から provider / kind を軽く推定する（後端 §3 の判定表と同じ規則）。
 * 追加ダイアログで「Google スプレッドシートとして認識・プレビュー可」と出すためだけに使い、
 * 保存される kind は必ず後端が決める。http(s) でなければ null。
 */
export function hintDocUrl(input: string): DocUrlHint | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  if (host === "docs.google.com") {
    for (const p of GOOGLE_PATTERNS) {
      if (p.re.test(path))
        return { provider: "google", kind: p.kind, previewable: true };
    }
    return { provider: "google", kind: "link", previewable: false };
  }
  if (host === "drive.google.com") {
    if (new RegExp(`^/file/d/${GOOGLE_ID}`).test(path))
      return { provider: "google", kind: "gfile", previewable: true };
    if (
      (path === "/open" || path === "/uc") &&
      /^[A-Za-z0-9_-]+$/.test(u.searchParams.get("id") ?? "")
    )
      return { provider: "google", kind: "gfile", previewable: true };
    if (new RegExp(`^/drive/(u/\\d+/)?folders/${GOOGLE_ID}`).test(path))
      return { provider: "google", kind: "gfolder", previewable: true };
    return { provider: "google", kind: "link", previewable: false };
  }
  if (
    host.endsWith(".sharepoint.com") ||
    host === "onedrive.live.com" ||
    host === "1drv.ms"
  )
    return { provider: "microsoft", kind: "ms", previewable: false };
  if (host === "box.com" || host.endsWith(".box.com"))
    return { provider: "box", kind: "box", previewable: false };
  return { provider: "other", kind: "link", previewable: false };
}

// ===================== 種類アイコン =====================

/** アイコン方块の種類（色分け用）。 */
export type DocFileType =
  | "pdf"
  | "xls"
  | "doc"
  | "ppt"
  | "img"
  | "folder"
  | "file"
  | "link";

const EXT_TYPE: Record<string, DocFileType> = {
  pdf: "pdf",
  xls: "xls",
  xlsx: "xls",
  xlsm: "xls",
  csv: "xls",
  doc: "doc",
  docx: "doc",
  txt: "doc",
  md: "doc",
  rtf: "doc",
  ppt: "ppt",
  pptx: "ppt",
  key: "ppt",
  png: "img",
  jpg: "img",
  jpeg: "img",
  gif: "img",
  webp: "img",
  svg: "img",
  heic: "img",
  bmp: "img",
};

/** 「仕様書.xlsx」「/a/b/c.pdf?x=1」などから拡張子（小文字）を取る。無ければ null。 */
export function extOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const base = name.split(/[?#]/)[0].split("/").pop() ?? "";
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(base);
  return m ? m[1].toLowerCase() : null;
}

function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return "";
  }
}

export const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";

const MIME_TYPE: Record<string, DocFileType> = {
  [GOOGLE_FOLDER_MIME]: "folder",
  "application/vnd.google-apps.spreadsheet": "xls",
  "application/vnd.google-apps.document": "doc",
  "application/vnd.google-apps.presentation": "ppt",
  "application/pdf": "pdf",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-excel.sheet.macroenabled.12": "xls",
  "text/csv": "xls",
  "text/tab-separated-values": "xls",
  "application/msword": "doc",
  "application/rtf": "doc",
  "text/plain": "doc",
  "text/markdown": "doc",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.apple.keynote": "ppt",
};

/**
 * mimeType（Google Picker の返却値）からアイコン種類を決める。判定できなければ null。
 * Office Open XML（xlsx/docx/pptx）は接頭辞で、画像は image/* で判定する。
 */
export function fileTypeFromMime(
  mime: string | null | undefined
): DocFileType | null {
  if (!mime) return null;
  const m = mime.trim().toLowerCase().split(";")[0];
  if (!m) return null;
  if (MIME_TYPE[m]) return MIME_TYPE[m];
  if (m.startsWith("image/")) return "img";
  const ooxml = "application/vnd.openxmlformats-officedocument.";
  if (m.startsWith(`${ooxml}spreadsheetml`)) return "xls";
  if (m.startsWith(`${ooxml}wordprocessingml`)) return "doc";
  if (m.startsWith(`${ooxml}presentationml`)) return "ppt";
  if (m.startsWith("application/vnd.oasis.opendocument.spreadsheet"))
    return "xls";
  if (m.startsWith("application/vnd.oasis.opendocument.text")) return "doc";
  if (m.startsWith("application/vnd.oasis.opendocument.presentation"))
    return "ppt";
  return null;
}

/** アイコン判定に使う資料の項目（mimeType は Picker 由来のときだけある）。 */
export type DocTypeSource = Pick<PmDoc, "kind" | "title" | "url"> &
  Partial<Pick<PmDoc, "mimeType">>;

/**
 * アイコン種類を決める：mimeType（Picker 由来）→ kind（Google ネイティブ形式・フォルダ）
 * → 表示名 / URL の拡張子（Drive 上の PDF・Excel、SharePoint、Box…）。
 */
export function docFileType(doc: DocTypeSource): DocFileType {
  const byMime = fileTypeFromMime(doc.mimeType);
  if (byMime) return byMime;
  switch (doc.kind) {
    case "gsheet":
      return "xls";
    case "gdoc":
      return "doc";
    case "gslide":
      return "ppt";
    case "gfolder":
      return "folder";
    default:
      break;
  }
  const ext = extOf(doc.title) ?? extOf(pathOf(doc.url));
  if (ext && EXT_TYPE[ext]) return EXT_TYPE[ext];
  if (doc.kind === "link") return "link";
  return "file";
}

// ===================== 表示名 =====================

/** 表示名の判定に使う資料の項目。kind / provider / isRoot は既定名の決定にだけ使う。 */
export type DocNameSource = Pick<PmDoc, "title" | "url"> &
  Partial<Pick<PmDoc, "kind" | "provider" | "isRoot">>;

/**
 * 表示名が無く URL にファイル名も無いときの既定名（i18n キー）。
 * ルートフォルダ・フォルダ →「Google ドライブのフォルダ」等（provider 別）、
 * Google ネイティブ形式 →「Google スプレッドシート」等、Drive 上のファイル →「Google ドライブのファイル」、
 * SharePoint / Box → それぞれのファイル。一般リンクは null（ホスト名の方が情報になる）。
 */
export function docDefaultNameKey(doc: DocNameSource): string | null {
  const provider = ["google", "microsoft", "box"].includes(doc.provider ?? "")
    ? (doc.provider as string)
    : "other";
  if (doc.isRoot || doc.kind === "gfolder")
    return `docs.defaultName.folder.${provider}`;
  switch (doc.kind) {
    case "gdoc":
    case "gsheet":
    case "gslide":
    case "ms":
    case "box":
      return `docs.kind.${doc.kind}`;
    case "gfile":
      return "docs.defaultName.gfile";
    default:
      return null;
  }
}

/**
 * 表示名：title → URL パス末尾のファイル名（拡張子付きのみ）→ 既定名（translate を渡した場合）→ ホスト名。
 * translate は i18n キー → 文言（UI では useDocName() 経由で渡す）。
 */
export function docDisplayName(
  doc: DocNameSource,
  translate?: (key: string) => string
): string {
  if (doc.title?.trim()) return doc.title.trim();
  let u: URL;
  try {
    u = new URL(doc.url);
  } catch {
    const key = translate && docDefaultNameKey(doc);
    return key ? translate(key) : doc.url;
  }
  const last = decodeURIComponent(u.pathname.split("/").pop() ?? "");
  if (extOf(last)) return last;
  const key = translate && docDefaultNameKey(doc);
  if (key) return translate(key);
  return u.hostname.replace(/^www\./, "");
}

// ===================== 絞り込み・グルーピング =====================

/** 種類フィルタ値（"all" = すべて）。 */
export type DocTypeFilter = "all" | DocFileType;

/**
 * 種類チップの並び（顧客資料ドロワー）。「すべて」以外は DocFileType。
 * フォルダはルート / 案件フォルダ専用で資料としては登録しないので、チップは出さない。
 */
export const DOC_TYPE_CHIPS: DocTypeFilter[] = [
  "all",
  "pdf",
  "xls",
  "doc",
  "ppt",
  "img",
];

/**
 * キーワード（表示名・URL・紐付けタスク名）と種類で絞る。
 * nameOf には画面に出している表示名の関数を渡す（既定名で検索できるように）。
 */
export function filterDocs(
  docs: PmDoc[],
  keyword: string,
  type: DocTypeFilter = "all",
  nameOf: (d: PmDoc) => string = (d) => docDisplayName(d)
): PmDoc[] {
  const kw = keyword.trim().toLowerCase();
  return docs.filter((d) => {
    if (type !== "all" && docFileType(d) !== type) return false;
    if (!kw) return true;
    const hay = [nameOf(d), d.url, ...d.tasks.map((t) => t.taskName)]
      .join(" ")
      .toLowerCase();
    return hay.includes(kw);
  });
}

export interface DocGroup {
  /** "common" = 顧客共通、それ以外は projectId */
  key: string;
  projectId: string | null;
  projectName: string | null;
  docs: PmDoc[];
}

/**
 * 顧客資料を「顧客共通 → 各案件」に分ける。顧客共通は常に先頭、案件は初出順
 * （後端が projectId → isRoot desc → createdAt で並べて返すので、その順序を崩さない）。
 */
export function groupDocsByProject(docs: PmDoc[]): DocGroup[] {
  const common: DocGroup = {
    key: "common",
    projectId: null,
    projectName: null,
    docs: [],
  };
  const byProject = new Map<string, DocGroup>();
  for (const d of docs) {
    if (!d.projectId) {
      common.docs.push(d);
      continue;
    }
    let g = byProject.get(d.projectId);
    if (!g) {
      g = {
        key: d.projectId,
        projectId: d.projectId,
        projectName: d.projectName,
        docs: [],
      };
      byProject.set(d.projectId, g);
    }
    g.docs.push(d);
  }
  const groups = [...byProject.values()];
  return common.docs.length > 0 ? [common, ...groups] : groups;
}

// ===================== タスク選択（WBS パス） =====================

export interface TaskPathOption {
  id: string;
  name: string;
  /** 「設計 / 画面設計 / ログイン」形式 */
  path: string;
  depth: number;
}

/**
 * タスクを WBS の表示順（order → 深さ優先）に並べ、各タスクの WBS パスを付ける。
 * 親がロード済み集合に無いタスクはルート扱い（取りこぼし防止）。
 */
export function taskPathOptions(tasks: Task[]): TaskPathOption[] {
  const ids = new Set(tasks.map((t) => t.id));
  const childrenOf = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const key = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    const arr = childrenOf.get(key);
    if (arr) arr.push(t);
    else childrenOf.set(key, [t]);
  }
  for (const arr of childrenOf.values())
    arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const out: TaskPathOption[] = [];
  const walk = (parent: string | null, prefix: string[], depth: number) => {
    for (const t of childrenOf.get(parent) ?? []) {
      const segs = [...prefix, t.name];
      out.push({ id: t.id, name: t.name, path: segs.join(" / "), depth });
      walk(t.id, segs, depth + 1);
    }
  };
  walk(null, [], 0);
  return out;
}

// ===================== Google Picker の選択結果 =====================

/** Google Picker で選んだ 1 件（googlePicker.ts の openPicker が返す）。 */
export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

/** Picker の Document（google.picker.Document）のうち使う項目。 */
export interface PickerDocLike {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  url?: unknown;
}

const DRIVE_ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_URL = 2000;
const MAX_TITLE = 200;

function httpUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_URL)
    return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Picker の Document → PickedFile。保存する URL は Picker の doc.url を優先し、
 * フォルダは必ず https://drive.google.com/drive/folders/{id}（後端の gfolder 判定と埋め込み表示に合う形）、
 * url が無い／不正なファイルは https://drive.google.com/file/d/{id}/view で補う。id が不正なら null（捨てる）。
 */
export function pickedFromPickerDoc(raw: PickerDocLike): PickedFile | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  if (!DRIVE_ID_RE.test(id)) return null;
  const mimeType = typeof raw.mimeType === "string" ? raw.mimeType : "";
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const url =
    mimeType === GOOGLE_FOLDER_MIME
      ? `https://drive.google.com/drive/folders/${id}`
      : (httpUrl(raw.url) ?? `https://drive.google.com/file/d/${id}/view`);
  return { id, name, mimeType, url };
}

/** 選択済みファイルを id で重複排除して後ろに足す（既にあるものは既存の行＝改名済みを残す）。 */
export function mergePicked<T extends { id: string }>(
  current: T[],
  added: T[]
): T[] {
  const seen = new Set(current.map((f) => f.id));
  const out = [...current];
  for (const f of added) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

/**
 * 選択ファイル（＋画面で変えた表示名）→ POST /docs/batch の items。
 * 表示名は 入力値 → ファイル名 の順、200 文字で切る。空なら title を送らない（後端・前端の既定名に任せる）。
 */
export function pickedToBatchItems(
  files: (PickedFile & { title?: string })[]
): BatchDocItem[] {
  return files.map((f) => {
    const title = (f.title?.trim() || f.name.trim()).slice(0, MAX_TITLE);
    return {
      url: f.url,
      ...(title ? { title } : {}),
      ...(f.mimeType ? { mimeType: f.mimeType } : {}),
    };
  });
}

/** PickedFile をアイコン・表示名の判定に渡す形（DocIcon 用）。 */
export function pickedAsDocSource(
  f: PickedFile
): DocTypeSource & DocNameSource {
  return {
    kind: f.mimeType === GOOGLE_FOLDER_MIME ? "gfolder" : "gfile",
    provider: "google",
    title: f.name || null,
    url: f.url,
    mimeType: f.mimeType || null,
  };
}

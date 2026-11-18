import { getDocPickerConfig } from "../api";
import type { DocPickerConfig } from "../types";
import {
  GOOGLE_FOLDER_MIME,
  type PickedFile,
  type PickerDocLike,
  pickedFromPickerDoc,
} from "../utils/doc";

/**
 * Google Picker（ドライブからファイル／フォルダを選ぶ）。設計：doc/design/pm-drive-docs.md §7
 *
 * - gapi（api.js → gapi.load("picker")）と Google Identity Services（gsi/client）を必要になった時だけ読み込む。
 * - OAuth スコープは drive.file（非機密）。アクセストークンはこのモジュールのメモリにだけ置き、
 *   ページ生存中は使い回し、期限が近ければ取り直す。**後端には送らない**（後端が受け取るのは url / 名称 / mimeType だけ）。
 * - 利用者が同意ポップアップを閉じた／拒否した／Picker をキャンセルした → `[]` を静かに返す。
 * - 読み込み失敗・ポップアップのブロック等 → PickerError（code ごとに画面で i18n 文言を出す）。
 */

const GAPI_SRC = "https://apis.google.com/js/api.js";
const GIS_SRC = "https://accounts.google.com/gsi/client";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const LOAD_TIMEOUT_MS = 15000;
/** 期限切れ直前のトークンを使わないための余裕 */
const TOKEN_MARGIN_MS = 60_000;

// ===================== 最小限の型宣言（gapi / google.picker / google.accounts.oauth2） =====================

interface GapiLoadOptions {
  callback: () => void;
  onerror?: () => void;
  timeout?: number;
  ontimeout?: () => void;
}

interface Gapi {
  load(name: string, options: GapiLoadOptions): void;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClientError {
  /** "popup_closed" | "popup_failed_to_open" | "unknown" */
  type?: string;
  message?: string;
}

interface TokenClientConfig {
  client_id: string;
  scope: string;
  callback: (resp: TokenResponse) => void;
  error_callback?: (err: TokenClientError) => void;
}

interface TokenClient {
  callback: (resp: TokenResponse) => void;
  error_callback?: (err: TokenClientError) => void;
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: TokenClientConfig): TokenClient;
  hasGrantedAllScopes(resp: TokenResponse, ...scopes: string[]): boolean;
}

interface PickerDocsView {
  setParent(id: string): PickerDocsView;
  setIncludeFolders(v: boolean): PickerDocsView;
  setSelectFolderEnabled(v: boolean): PickerDocsView;
  setMimeTypes(mimeTypes: string): PickerDocsView;
  setEnableDrives(v: boolean): PickerDocsView;
  /** 比較的新しい API。無い環境もあるので呼ぶ前に存在確認する */
  setLabel?(label: string): PickerDocsView;
}

interface PickerResponse {
  action?: string;
  docs?: PickerDocLike[];
  [key: string]: unknown;
}

interface Picker {
  setVisible(v: boolean): void;
  dispose?(): void;
}

interface PickerBuilder {
  addView(view: PickerDocsView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setLocale(locale: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setCallback(cb: (data: PickerResponse) => void): PickerBuilder;
  build(): Picker;
}

interface GooglePickerNs {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => PickerDocsView;
  ViewId: { DOCS: string; FOLDERS: string };
  Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string };
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string; DOCUMENTS: string };
}

declare global {
  interface Window {
    gapi?: Gapi;
    google?: {
      picker?: GooglePickerNs;
      accounts?: { oauth2?: GoogleOAuth2 };
    };
  }
}

// ===================== エラー =====================

/**
 * - config：管理者が Picker を設定していない（enabled=false）／設定取得に失敗
 * - load：Google のスクリプトを読み込めない（ネットワーク・拡張機能のブロック等）
 * - popup：同意ポップアップを開けない（ブラウザのポップアップブロック）
 * - auth：認可でエラー（OAuth クライアントの生成元が未登録など）
 * - scope：同意画面でドライブの権限にチェックが入らなかった
 */
export type PickerErrorCode = "config" | "load" | "popup" | "auth" | "scope";

export class PickerError extends Error {
  readonly code: PickerErrorCode;
  constructor(code: PickerErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "PickerError";
    this.code = code;
  }
}

// ===================== 設定（1 回だけ取得してキャッシュ） =====================

let configPromise: Promise<DocPickerConfig> | null = null;

/** GET /docs/picker-config を 1 回だけ取りに行く（失敗したら次回また取りに行く）。 */
export function loadPickerConfig(): Promise<DocPickerConfig> {
  if (!configPromise) {
    configPromise = getDocPickerConfig().catch((e) => {
      configPromise = null;
      throw e;
    });
  }
  return configPromise;
}

// ===================== スクリプト読み込み =====================

const scriptPromises = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const cached = scriptPromises.get(src);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.defer = true;
    const timer = window.setTimeout(() => {
      el.remove();
      reject(new PickerError("load", `timeout ${src}`));
    }, LOAD_TIMEOUT_MS);
    el.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    el.onerror = () => {
      window.clearTimeout(timer);
      el.remove();
      reject(new PickerError("load", src));
    };
    document.head.appendChild(el);
  });
  // 失敗したら次回は読み込み直す
  p.catch(() => scriptPromises.delete(src));
  scriptPromises.set(src, p);
  return p;
}

let pickerApiPromise: Promise<GooglePickerNs> | null = null;

function loadPickerApi(): Promise<GooglePickerNs> {
  if (!pickerApiPromise) {
    pickerApiPromise = loadScript(GAPI_SRC)
      .then(
        () =>
          new Promise<GooglePickerNs>((resolve, reject) => {
            const gapi = window.gapi;
            if (!gapi) {
              reject(new PickerError("load", "gapi"));
              return;
            }
            const fail = () => reject(new PickerError("load", "gapi.picker"));
            gapi.load("picker", {
              callback: () => {
                const ns = window.google?.picker;
                if (ns) resolve(ns);
                else fail();
              },
              onerror: fail,
              timeout: LOAD_TIMEOUT_MS,
              ontimeout: fail,
            });
          })
      )
      .catch((e) => {
        pickerApiPromise = null;
        throw e;
      });
  }
  return pickerApiPromise;
}

async function loadOAuth2(): Promise<GoogleOAuth2> {
  await loadScript(GIS_SRC);
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new PickerError("load", "google.accounts.oauth2");
  return oauth2;
}

// ===================== アクセストークン（メモリのみ） =====================

let token: { value: string; expiresAt: number; clientId: string } | null = null;
let tokenClient: { client: TokenClient; clientId: string } | null = null;

/** 利用者が閉じた／拒否した（エラーではない） */
const CANCELLED = Symbol("cancelled");

function requestToken(
  oauth2: GoogleOAuth2,
  clientId: string
): Promise<string | typeof CANCELLED> {
  if (
    token &&
    token.clientId === clientId &&
    token.expiresAt - TOKEN_MARGIN_MS > Date.now()
  )
    return Promise.resolve(token.value);

  if (!tokenClient || tokenClient.clientId !== clientId) {
    tokenClient = {
      clientId,
      client: oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_FILE_SCOPE,
        callback: () => {},
      }),
    };
  }
  const client = tokenClient.client;
  const hadToken = token?.clientId === clientId;

  return new Promise((resolve, reject) => {
    client.callback = (resp) => {
      if (resp.error) {
        // access_denied = 同意画面で拒否 → キャンセル扱い
        if (resp.error === "access_denied") resolve(CANCELLED);
        else reject(new PickerError("auth", resp.error));
        return;
      }
      if (!resp.access_token) {
        reject(new PickerError("auth", "no access_token"));
        return;
      }
      if (!oauth2.hasGrantedAllScopes(resp, DRIVE_FILE_SCOPE)) {
        reject(new PickerError("scope"));
        return;
      }
      const sec = Number(resp.expires_in) || 3600;
      token = {
        value: resp.access_token,
        expiresAt: Date.now() + sec * 1000,
        clientId,
      };
      resolve(resp.access_token);
    };
    client.error_callback = (err) => {
      if (err?.type === "popup_closed") resolve(CANCELLED);
      else if (err?.type === "popup_failed_to_open")
        reject(new PickerError("popup"));
      else reject(new PickerError("auth", err?.type ?? err?.message));
    };
    // 2 回目以降（期限切れの取り直し）は同意画面を省略できるならそうする
    client.requestAccessToken(hadToken ? { prompt: "" } : undefined);
  });
}

// ===================== フォーカス保護 =====================

/**
 * antd の Modal / Drawer は focus trap で「外に出たフォーカス」を引き戻す（window の focusin を監視）。
 * Picker の iframe は body 直下に出るので、そのままだと Picker の検索欄に入力できない。
 * Picker 表示中だけ、Picker 内への focusin を捕捉段階で止めて trap に届かないようにする。
 */
function guardPickerFocus(): () => void {
  const onFocusIn = (e: FocusEvent) => {
    const target = e.target;
    if (
      target instanceof Element &&
      target.closest(".picker-dialog, .picker-dialog-bg, .picker")
    )
      e.stopImmediatePropagation();
  };
  window.addEventListener("focusin", onFocusIn, true);
  return () => window.removeEventListener("focusin", onFocusIn, true);
}

/**
 * 設定とスクリプトを先読みする（失敗は握りつぶす。本番の openPicker で改めてエラーにする）。
 * 同意ポップアップはクリック直後でないとブロックされやすいので、ダイアログ表示時に呼んでおく。
 */
export function preloadPicker(): void {
  loadPickerConfig()
    .then((c) => {
      if (!c.enabled) return undefined;
      return Promise.all([loadPickerApi(), loadOAuth2()]);
    })
    .catch(() => {});
}

// ===================== Picker =====================

export interface OpenPickerOptions {
  /** 「このフォルダ」ビューの起点（ルートフォルダの Drive id） */
  parentFolderId?: string | null;
  multiselect?: boolean;
  /** フォルダだけを選ばせる（ルートフォルダ設定用） */
  foldersOnly?: boolean;
  /**
   * ファイル選択でフォルダも選べるようにする（既定 true）。選ばれたフォルダは呼び出し側が中のファイルに展開する
   * （フォルダ自体は資料として登録しない）。展開用に開き直す Picker では false にしてファイルだけにする。
   */
  allowFolders?: boolean;
  /** Picker の表示言語（"ja" / "en" / "zh-CN" / "zh-TW"） */
  locale?: string;
  /** Picker のタイトルと各ビューの名前 */
  labels?: {
    title?: string;
    thisFolder?: string;
    myDrive?: string;
    sharedDrives?: string;
  };
}

/** umi の locale（ja-JP 等）→ Picker の hl。 */
export function pickerLocale(umiLocale: string | undefined): string {
  if (!umiLocale) return "ja";
  if (umiLocale.startsWith("zh"))
    return umiLocale.includes("TW") ? "zh-TW" : "zh-CN";
  return umiLocale.split("-")[0];
}

function makeView(
  ns: GooglePickerNs,
  foldersOnly: boolean,
  allowFolders: boolean,
  label?: string
): PickerDocsView {
  const v = foldersOnly
    ? new ns.DocsView(ns.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes(GOOGLE_FOLDER_MIME)
    : new ns.DocsView(ns.ViewId.DOCS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(allowFolders);
  if (label && typeof v.setLabel === "function") v.setLabel(label);
  return v;
}

/**
 * Google Picker を開いて選ばれたファイルを返す。キャンセル（同意ポップアップを閉じた・拒否・Picker のキャンセル）は `[]`。
 * 設定なし・読み込み失敗・ポップアップブロックなどは PickerError で reject する。
 * 同意ポップアップを出すため、クリック等の利用者操作の中から呼ぶこと。
 */
export async function openPicker(
  options: OpenPickerOptions = {}
): Promise<PickedFile[]> {
  const config = await loadPickerConfig().catch(() => {
    throw new PickerError("config");
  });
  if (!config.enabled || !config.clientId || !config.apiKey || !config.appId)
    throw new PickerError("config");

  const [ns, oauth2] = await Promise.all([loadPickerApi(), loadOAuth2()]);
  const accessToken = await requestToken(oauth2, config.clientId);
  if (accessToken === CANCELLED) return [];

  const {
    parentFolderId,
    multiselect,
    foldersOnly = false,
    allowFolders = true,
    labels,
  } = options;

  return new Promise<PickedFile[]>((resolve) => {
    let releaseFocus: (() => void) | null = null;
    let picker: Picker | null = null;
    const finish = (files: PickedFile[]) => {
      releaseFocus?.();
      releaseFocus = null;
      picker?.dispose?.();
      resolve(files);
    };

    const builder = new ns.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(config.apiKey as string)
      .setAppId(config.appId as string)
      .enableFeature(ns.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        const action = data[ns.Response.ACTION] ?? data.action;
        if (action === ns.Action.PICKED) {
          const docs = (data[ns.Response.DOCUMENTS] ?? data.docs ?? []) as
            | PickerDocLike[]
            | undefined;
          finish(
            (docs ?? [])
              .map(pickedFromPickerDoc)
              .filter((f): f is PickedFile => f !== null)
              .filter((f) => {
                const isFolder = f.mimeType === GOOGLE_FOLDER_MIME;
                return foldersOnly ? isFolder : allowFolders || !isFolder;
              })
          );
        } else if (action === ns.Action.CANCEL) {
          finish([]);
        }
        // "loaded" など他のアクションは無視
      });
    if (options.locale) builder.setLocale(options.locale);
    if (labels?.title) builder.setTitle(labels.title);
    if (multiselect && !foldersOnly)
      builder.enableFeature(ns.Feature.MULTISELECT_ENABLED);

    // ビュー：ルートフォルダがあれば「このフォルダ」を先頭に → マイドライブ → 共有ドライブ
    if (parentFolderId)
      builder.addView(
        makeView(ns, foldersOnly, allowFolders, labels?.thisFolder).setParent(
          parentFolderId
        )
      );
    builder.addView(
      makeView(ns, foldersOnly, allowFolders, labels?.myDrive).setParent("root")
    );
    builder.addView(
      makeView(
        ns,
        foldersOnly,
        allowFolders,
        labels?.sharedDrives
      ).setEnableDrives(true)
    );

    releaseFocus = guardPickerFocus();
    picker = builder.build();
    picker.setVisible(true);
  });
}

// ===================== フォルダ内のファイル一覧（Drive API） =====================

/** 1 回の展開で集めるファイルの上限（サブフォルダを含む） */
const LIST_LIMIT = 200;

interface DriveListResponse {
  nextPageToken?: string;
  files?: {
    id?: string;
    name?: string;
    mimeType?: string;
    webViewLink?: string;
  }[];
}

/**
 * フォルダ内のファイルをサブフォルダまで辿って集める（フォルダ自体は返さない）。直前の openPicker で取ったトークンを使う。
 * drive.file スコープでは「利用者が Picker で選んだもの」しか見えないため、中身が返らない（空）ことが多い。
 * 空・失敗・トークン無しは null を返し、呼び出し側はそのフォルダを起点に Picker を開き直してファイルを選んでもらう。
 */
export async function listFolderFiles(
  folderId: string
): Promise<PickedFile[] | null> {
  if (!token || token.expiresAt - TOKEN_MARGIN_MS < Date.now()) return null;
  const out: PickedFile[] = [];
  const queue = [folderId];
  const seen = new Set<string>();
  try {
    while (queue.length > 0 && out.length < LIST_LIMIT) {
      const id = queue.shift() as string;
      if (seen.has(id) || !/^[A-Za-z0-9_-]+$/.test(id)) continue;
      seen.add(id);
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q: `'${id}' in parents and trashed = false`,
          fields: "nextPageToken,files(id,name,mimeType,webViewLink)",
          pageSize: "200",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files?${params}`,
          { headers: { Authorization: `Bearer ${token.value}` } }
        );
        if (!res.ok) return out.length > 0 ? out : null;
        const body = (await res.json()) as DriveListResponse;
        for (const f of body.files ?? []) {
          if (f.mimeType === GOOGLE_FOLDER_MIME) {
            if (f.id) queue.push(f.id);
            continue;
          }
          const picked = pickedFromPickerDoc({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            url: f.webViewLink,
          });
          if (picked) out.push(picked);
        }
        pageToken = body.nextPageToken;
      } while (pageToken && out.length < LIST_LIMIT);
    }
  } catch {
    return out.length > 0 ? out : null;
  }
  return out.length > 0 ? out.slice(0, LIST_LIMIT) : null;
}

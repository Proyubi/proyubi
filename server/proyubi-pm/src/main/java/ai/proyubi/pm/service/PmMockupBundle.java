package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipInputStream;

/**
 * 公開する効果図の中身：入口 HTML + 付属ファイル。単一 HTML / zip / ファイル一覧（MCP）から組み立てる。
 * 設計：doc/design/pm-mockup.md §7
 * <ul>
 *   <li>パスは / 区切り・NFC 正規化（macOS の zip は NFD で入るが HTML 側の参照は NFC）。
 *       絶対パス・{@code ..}・ドライブレター・制御文字を含むものは拒否（zip slip 対策）。</li>
 *   <li>{@code __MACOSX/}・{@code .DS_Store}・{@code ._*}・{@code Thumbs.db}・拡張子がホワイトリスト外のファイルは黙って捨てる。
 *       Content-Type はここで拡張子から決め、配信時もこの値を使う（アップロード側の申告は信用しない）。</li>
 *   <li>全ファイルが同じ 1 フォルダに入っている zip（「フォルダごと圧縮」）はそのフォルダを剥がす。</li>
 *   <li>入口：ルートの index.html → ルートの唯一の HTML → 全体で唯一の HTML。決まらなければエラー。</li>
 *   <li>展開サイズ・ファイル数は実際に読んだバイトで数える（zip ヘッダーの申告サイズは信用しない＝zip bomb 対策）。</li>
 * </ul>
 *
 * @param entryPath  入口 HTML のパス
 * @param entryHtml  入口 HTML 原文
 * @param assets     入口以外のファイル（パス昇順）
 * @param totalBytes 入口を含む合計バイト数
 * @param sha256     同一内容判定用ハッシュ（単一 HTML = 本文の SHA-256、複数 = パス + 各ハッシュ一覧の SHA-256）
 */
public record PmMockupBundle(String entryPath, String entryHtml, List<Asset> assets, int totalBytes,
                             String sha256) {

    /** 単一 HTML の入口パス */
    public static final String DEFAULT_ENTRY = "index.html";

    /** 入口以外のファイル */
    public record Asset(String path, String contentType, byte[] data) {
    }

    /** 展開直後 / MCP から受け取った生ファイル */
    public record RawFile(String path, byte[] data) {
    }

    /** 上限：入口 HTML 単体 / 展開後合計 / ファイル数 */
    public record Limits(int maxHtmlBytes, int maxTotalBytes, int maxFiles) {
    }

    private static final Pattern DRIVE_LETTER = Pattern.compile("^[A-Za-z]:");

    /** 拡張子 → Content-Type（ここに無い拡張子は公開しない） */
    private static final Map<String, String> CONTENT_TYPES = Map.ofEntries(
        Map.entry("html", "text/html; charset=utf-8"),
        Map.entry("htm", "text/html; charset=utf-8"),
        Map.entry("css", "text/css; charset=utf-8"),
        Map.entry("js", "text/javascript; charset=utf-8"),
        Map.entry("mjs", "text/javascript; charset=utf-8"),
        Map.entry("json", "application/json"),
        Map.entry("map", "application/json"),
        Map.entry("txt", "text/plain; charset=utf-8"),
        Map.entry("md", "text/plain; charset=utf-8"),
        Map.entry("csv", "text/csv; charset=utf-8"),
        Map.entry("xml", "application/xml"),
        Map.entry("svg", "image/svg+xml"),
        Map.entry("png", "image/png"),
        Map.entry("jpg", "image/jpeg"),
        Map.entry("jpeg", "image/jpeg"),
        Map.entry("gif", "image/gif"),
        Map.entry("webp", "image/webp"),
        Map.entry("avif", "image/avif"),
        Map.entry("ico", "image/x-icon"),
        Map.entry("bmp", "image/bmp"),
        Map.entry("woff", "font/woff"),
        Map.entry("woff2", "font/woff2"),
        Map.entry("ttf", "font/ttf"),
        Map.entry("otf", "font/otf"),
        Map.entry("mp4", "video/mp4"),
        Map.entry("webm", "video/webm"),
        Map.entry("mp3", "audio/mpeg"),
        Map.entry("wav", "audio/wav"),
        Map.entry("ogg", "audio/ogg"),
        Map.entry("pdf", "application/pdf"),
        Map.entry("wasm", "application/wasm"),
        Map.entry("glb", "model/gltf-binary"),
        Map.entry("gltf", "model/gltf+json")
    );

    /** 単一 HTML。 */
    public static PmMockupBundle ofHtml(String html, Limits limits) {
        if (html == null || html.isBlank()) {
            throw BizException.of(400, "HTML が空です");
        }
        byte[] bytes = html.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > limits.maxHtmlBytes()) {
            throw BizException.of(400, "HTML が大きすぎます（上限 " + mb(limits.maxHtmlBytes()) + "MB）");
        }
        checkStorableHtml(html, DEFAULT_ENTRY);
        return new PmMockupBundle(DEFAULT_ENTRY, html, List.of(), bytes.length,
            PmMockupUrlSigner.sha256Hex(bytes));
    }

    /** zip を展開して組み立てる。ファイル名は UTF-8、壊れていれば Shift_JIS（Windows の「送る→圧縮」）で読み直す。 */
    public static PmMockupBundle ofZip(byte[] zip, Limits limits) {
        if (zip == null || zip.length == 0) {
            throw BizException.of(400, "zip が空です");
        }
        List<RawFile> files;
        try {
            files = unzip(zip, limits, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException malformedName) {
            files = unzip(zip, limits, Charset.forName("MS932"));
        }
        return ofFiles(files, limits);
    }

    /** ファイル一覧（zip 展開結果 / MCP のフォルダ公開）から組み立てる。 */
    public static PmMockupBundle ofFiles(List<RawFile> raw, Limits limits) {
        Map<String, byte[]> files = new LinkedHashMap<>();
        for (RawFile f : raw) {
            String p = normalizePath(f.path());
            if (p == null || contentTypeOf(p) == null) {
                continue;
            }
            if (files.put(p, f.data()) != null) {
                throw BizException.of(400, "同じパスのファイルが重複しています：" + p);
            }
        }
        files = stripCommonFolder(files);
        if (files.isEmpty()) {
            throw BizException.of(400, "公開できるファイルがありません（HTML・画像・CSS・JS など）");
        }
        if (files.size() > limits.maxFiles()) {
            throw BizException.of(400, "ファイル数が多すぎます（上限 " + limits.maxFiles() + " 個）");
        }
        long total = files.values().stream().mapToLong(b -> b.length).sum();
        if (total > limits.maxTotalBytes()) {
            throw BizException.of(400, "展開後のサイズが大きすぎます（上限 " + mb(limits.maxTotalBytes()) + "MB）");
        }

        String entry = pickEntry(files.keySet());
        byte[] entryBytes = files.get(entry);
        if (entryBytes.length > limits.maxHtmlBytes()) {
            throw BizException.of(400, entry + " が大きすぎます（上限 " + mb(limits.maxHtmlBytes()) + "MB）");
        }
        String entryHtml = new String(entryBytes, StandardCharsets.UTF_8);
        if (entryHtml.isBlank()) {
            throw BizException.of(400, entry + " が空です");
        }
        checkStorableHtml(entryHtml, entry);

        List<String> paths = new ArrayList<>(files.keySet());
        paths.sort(Comparator.naturalOrder());
        StringBuilder manifest = new StringBuilder();
        List<Asset> assets = new ArrayList<>();
        for (String p : paths) {
            byte[] data = files.get(p);
            manifest.append(p).append('\t').append(PmMockupUrlSigner.sha256Hex(data)).append('\n');
            if (!p.equals(entry)) {
                assets.add(new Asset(p, contentTypeOf(p), data));
            }
        }
        // 入口だけの包は単一 HTML と同じハッシュにする（同じ index.html を zip で出し直しても新版を作らない）。
        // ofHtml と同じく「文字列 → UTF-8」のバイトで計算（BOM・不正バイトがあっても一致させる）
        String sha = assets.isEmpty() && entry.equals(DEFAULT_ENTRY)
            ? PmMockupUrlSigner.sha256Hex(entryHtml.getBytes(StandardCharsets.UTF_8))
            : PmMockupUrlSigner.sha256Hex(manifest.toString().getBytes(StandardCharsets.UTF_8));
        return new PmMockupBundle(entry, entryHtml, assets, (int) total, sha);
    }

    /** ファイル数（入口を含む） */
    public int fileCount() {
        return assets.size() + 1;
    }

    /**
     * パスの正規化。安全でないパスは例外、捨てるべきもの（ディレクトリ・OS のゴミ）は null。
     * 配信時のリクエストパスにも同じ規則を使う（{@link #normalizeRequestPath}）。
     */
    static String normalizePath(String name) {
        if (name == null) {
            return null;
        }
        String p = Normalizer.normalize(name.replace('\\', '/'), Normalizer.Form.NFC);
        while (p.startsWith("./")) {
            p = p.substring(2);
        }
        if (p.isEmpty() || p.endsWith("/")) {
            return null;
        }
        if (p.startsWith("/") || DRIVE_LETTER.matcher(p).find()) {
            throw BizException.of(400, "不正なファイルパスです：" + name);
        }
        for (String seg : p.split("/", -1)) {
            if (seg.isEmpty() || seg.equals(".") || seg.equals("..")) {
                throw BizException.of(400, "不正なファイルパスです：" + name);
            }
            if (seg.chars().anyMatch(c -> c < 0x20 || c == 0x7f)) {
                throw BizException.of(400, "不正なファイルパスです：" + name);
            }
        }
        String base = p.substring(p.lastIndexOf('/') + 1);
        if (p.startsWith("__MACOSX/") || base.equals(".DS_Store") || base.startsWith("._")
            || base.equalsIgnoreCase("Thumbs.db") || base.equalsIgnoreCase("desktop.ini")) {
            return null;
        }
        return p;
    }

    /**
     * 配信時のリクエストパス（先頭の / 付き、URL デコード済み）を保存時と同じ形に。
     * 空・末尾 / は index.html を補う。不正なら null。
     */
    public static String normalizeRequestPath(String path) {
        String p = path == null ? "" : path;
        while (p.startsWith("/")) {
            p = p.substring(1);
        }
        if (p.isEmpty() || p.endsWith("/")) {
            p = p + DEFAULT_ENTRY;
        }
        try {
            return normalizePath(p);
        } catch (BizException e) {
            return null;
        }
    }

    /** 拡張子から Content-Type。ホワイトリスト外は null。 */
    public static String contentTypeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0 || dot < path.lastIndexOf('/')) {
            return null;
        }
        return CONTENT_TYPES.get(path.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    public static boolean isHtml(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        return lower.endsWith(".html") || lower.endsWith(".htm");
    }

    private static List<RawFile> unzip(byte[] zip, Limits limits, Charset charset) {
        List<RawFile> out = new ArrayList<>();
        long total = 0;
        int entries = 0;
        byte[] buf = new byte[64 * 1024];
        try (ZipInputStream in = new ZipInputStream(new ByteArrayInputStream(zip), charset)) {
            ZipEntry e;
            while ((e = in.getNextEntry()) != null) {
                // 捨てるエントリも数える（大量の空エントリで CPU を食わせない）
                if (++entries > limits.maxFiles() * 4) {
                    throw BizException.of(400, "ファイル数が多すぎます（上限 " + limits.maxFiles() + " 個）");
                }
                String p = e.isDirectory() ? null : normalizePath(e.getName());
                boolean keep = p != null && contentTypeOf(p) != null;
                // 捨てるエントリも読み切って数える（getNextEntry の読み飛ばしも全量展開するため、
                // 高圧縮の不要ファイルで CPU を食わせない）
                ByteArrayOutputStream bos = keep ? new ByteArrayOutputStream() : null;
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > limits.maxTotalBytes()) {
                        throw BizException.of(400, "展開後のサイズが大きすぎます（上限 " + mb(limits.maxTotalBytes()) + "MB）");
                    }
                    if (keep) {
                        bos.write(buf, 0, n);
                    }
                }
                if (keep) {
                    out.add(new RawFile(e.getName(), bos.toByteArray()));
                }
            }
        } catch (ZipException e) {
            throw BizException.of(400, "zip を展開できません（" + e.getMessage() + "）");
        } catch (IOException e) {
            throw BizException.of(400, "zip を読み込めません");
        }
        if (entries == 0) {
            throw BizException.of(400, "zip ファイルではないか、中身が空です");
        }
        return out;
    }

    /** 全ファイルが同じトップフォルダ配下なら剥がす（1 段だけ）。 */
    private static Map<String, byte[]> stripCommonFolder(Map<String, byte[]> files) {
        String prefix = null;
        for (String p : files.keySet()) {
            int slash = p.indexOf('/');
            if (slash < 0) {
                return files;
            }
            String top = p.substring(0, slash + 1);
            if (prefix == null) {
                prefix = top;
            } else if (!prefix.equals(top)) {
                return files;
            }
        }
        if (prefix == null) {
            return files;
        }
        Map<String, byte[]> out = new LinkedHashMap<>();
        for (Map.Entry<String, byte[]> e : files.entrySet()) {
            out.put(e.getKey().substring(prefix.length()), e.getValue());
        }
        return out;
    }

    private static String pickEntry(java.util.Set<String> paths) {
        if (paths.contains(DEFAULT_ENTRY)) {
            return DEFAULT_ENTRY;
        }
        for (String p : paths) {
            if (p.equalsIgnoreCase(DEFAULT_ENTRY) || p.equalsIgnoreCase("index.htm")) {
                return p;
            }
        }
        List<String> html = paths.stream().filter(PmMockupBundle::isHtml).toList();
        List<String> rootHtml = html.stream().filter(p -> !p.contains("/")).toList();
        if (rootHtml.size() == 1) {
            return rootHtml.get(0);
        }
        if (rootHtml.isEmpty() && html.size() == 1) {
            return html.get(0);
        }
        if (html.isEmpty()) {
            throw BizException.of(400, "HTML ファイルが含まれていません");
        }
        throw BizException.of(400, "入口の HTML を特定できません。index.html という名前のファイルを含めてください（候補："
            + String.join(", ", html.stream().limit(5).toList()) + (html.size() > 5 ? " ほか" : "") + "）");
    }

    /** PostgreSQL の text は NUL を保存できない（insert が 500 になる）ので 400 で弾く。 */
    private static void checkStorableHtml(String html, String name) {
        if (html.indexOf('\u0000') >= 0) {
            throw BizException.of(400, name + " にテキストとして扱えない文字（NUL）が含まれています");
        }
    }

    private static int mb(int bytes) {
        return bytes / 1024 / 1024;
    }
}

package ai.proyubi.pm.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import ai.proyubi.common.core.exception.BizException;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Locale;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;

/**
 * 設計内容の検証と整形（純関数、DB に依存しない）。
 * <ul>
 *   <li>excalidraw：JSON をデータとして解析し、要素・必要な appState・参照されている画像だけを残して再シリアライズする。
 *       collaborators / 選択状態 / ダイアログ等の瞬間状態は保存しない。embeddable / iframe は拒否（任意 URL 埋め込みを作らない）。
 *       画像は data URL（png / jpeg / gif / webp）のみ。blob: など端末でしか有効でない参照は拒否。</li>
 *   <li>pen：原文バイトを base64 のまま無改変で保持する（未知フィールドを落とさない、PNG 化しない）。
 *       画框の同期用に、原文 JSON の最上位 frame（id / name）だけを読み取る（{@link #penFrames}）。</li>
 * </ul>
 * 上限超過・形式不正はすべて 400（利用者が直せるメッセージ付き）。
 *
 */
public final class PmDesignContent {

    public static final String FORMAT_EXCALIDRAW = "excalidraw";
    public static final String FORMAT_PEN = "pen";

    /** 保存してよい appState キー（全て JSON で表現できる表示設定） */
    private static final List<String> APP_STATE_KEYS = List.of(
        "viewBackgroundColor", "gridSize", "gridStep", "gridModeEnabled", "theme",
        "zoom", "scrollX", "scrollY", "name", "objectsSnapModeEnabled");
    /** 任意 URL / HTML を描画しうる要素型 */
    private static final Set<String> FORBIDDEN_TYPES = Set.of("embeddable", "iframe");
    private static final Set<String> IMAGE_MIME = Set.of("image/png", "image/jpeg", "image/gif", "image/webp");

    /** 画像ヘッダーのみを調べ、デコード時の過大なメモリ使用を防ぐ。 */
    private static final int MAX_IMAGE_EDGE = 32768;
    private static final long MAX_IMAGE_PIXELS = 40_000_000L;
    private static final ObjectMapper OM = new ObjectMapper();

    static {
        // 10MiB 級の data URL 文字列を読めるように（Jackson 既定の 20MB 文字列上限より余裕を持たせる）
        OM.getFactory().setStreamReadConstraints(StreamReadConstraints.builder()
            .maxStringLength(64 * 1024 * 1024).maxNestingDepth(200).build());
    }

    private PmDesignContent() {
    }

    /** 上限：全体 UTF-8 バイト（画像込み）、要素数、画像 1 枚の復号後バイト */
    public record Limits(int maxBytes, int maxElements, int maxImageBytes) {
    }

    /** 保存形：content は DB にそのまま入る文字列、sha256 / sizeBytes は原文バイト基準 */
    public record Normalized(String content, String encoding, int sizeBytes, String sha256) {
    }

    /** 新規白板の空場面 */
    public static String emptyScene() {
        return "{\"type\":\"excalidraw\",\"version\":2,\"elements\":[],\"appState\":{},\"files\":{}}";
    }

    public static Normalized normalizeExcalidraw(String json, Limits limits) {
        if (json == null || json.isBlank()) {
            throw bad("白板データが空です");
        }
        int inBytes = json.getBytes(StandardCharsets.UTF_8).length;
        if (inBytes > limits.maxBytes()) {
            throw tooLarge(limits.maxBytes());
        }
        JsonNode root;
        try {
            root = OM.readTree(json);
        } catch (JsonProcessingException e) {
            throw bad("白板データが JSON として読めません");
        }
        if (root == null || !root.isObject()) {
            throw bad("白板データの形式が不正です（オブジェクトではありません）");
        }
        JsonNode elementsIn = root.get("elements");
        if (elementsIn == null || !elementsIn.isArray()) {
            throw bad("白板データの形式が不正です（elements がありません）");
        }

        ObjectNode out = OM.createObjectNode();
        out.put("type", "excalidraw");
        out.put("version", 2);
        ArrayNode elements = out.putArray("elements");
        Set<String> fileIds = new HashSet<>();
        for (JsonNode el : elementsIn) {
            if (!el.isObject() || !el.path("id").isTextual() || el.path("id").asText().isEmpty()
                || !el.path("type").isTextual()) {
                throw bad("白板データの要素に id / type がありません");
            }
            if (el.path("isDeleted").asBoolean(false)) {
                continue;
            }
            String type = el.get("type").asText();
            if (FORBIDDEN_TYPES.contains(type)) {
                throw bad("埋め込み（" + type + "）要素は保存できません");
            }
            if ("image".equals(type)) {
                if (!el.path("fileId").isTextual()) {
                    throw bad("画像要素に fileId がありません");
                }
                fileIds.add(el.get("fileId").asText());
            }
            elements.add(el);
        }
        if (elements.size() > limits.maxElements()) {
            throw bad("要素が多すぎます（上限 " + limits.maxElements() + " 個）");
        }

        ObjectNode app = out.putObject("appState");
        JsonNode appIn = root.path("appState");
        if (appIn.isObject()) {
            for (String key : APP_STATE_KEYS) {
                JsonNode v = appIn.get(key);
                if (v != null && !v.isNull() && (v.isValueNode() || "zoom".equals(key) && v.isObject())) {
                    app.set(key, "zoom".equals(key) ? zoom(v) : v);
                }
            }
        }

        ObjectNode files = out.putObject("files");
        JsonNode filesIn = root.path("files");
        for (String fileId : fileIds.stream().sorted().toList()) {
            JsonNode f = filesIn.get(fileId);
            if (f == null || !f.isObject()) {
                throw bad("画像データが欠落しています（" + fileId + "）。画像を貼り直してから保存してください");
            }
            files.set(fileId, image(fileId, f, limits));
        }

        String content = out.toString();
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > limits.maxBytes()) {
            throw tooLarge(limits.maxBytes());
        }
        return new Normalized(content, "json", bytes.length, sha256Hex(bytes));
    }

    /** .pen 原文（base64）。復号して上限とハッシュを確認するだけで、内容は 1 バイトも変えない。 */
    public static Normalized normalizePen(String base64, Limits limits) {
        if (base64 == null || base64.isBlank()) {
            throw bad(".pen ファイルが空です");
        }
        if (base64.length() > 4L * ((limits.maxBytes() + 2L) / 3L)) {
            throw penTooLarge(limits.maxBytes());
        }
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(base64);
        } catch (IllegalArgumentException e) {
            throw bad(".pen ファイルの base64 が不正です");
        }
        if (raw.length == 0) {
            throw bad(".pen ファイルが空です");
        }
        if (raw.length > limits.maxBytes()) {
            throw penTooLarge(limits.maxBytes());
        }
        return new Normalized(Base64.getEncoder().encodeToString(raw), "base64", raw.length, sha256Hex(raw));
    }

    /** .pen の画框：最上位ノードのうち type = frame かつ reusable でない（コンポーネント定義を除く）もの */
    public record PenFrame(String nodeId, String name) {
    }

    /**
     * .pen 原文（UTF-8 JSON）から最上位の画框を原文の順で取り出す。JSON として読めない .pen は 400
     * （Pencil の .pen は平文 JSON。読めない = 壊れている / 別形式）。id の重複は先勝ち。
     */
    public static List<PenFrame> penFrames(byte[] raw) {
        JsonNode root;
        try {
            root = OM.readTree(raw);
        } catch (IOException e) {
            throw bad(".pen ファイルを JSON として読めません（Pencil で保存し直した .pen を選んでください）");
        }
        JsonNode children = root == null ? null : root.get("children");
        if (children == null || !children.isArray()) {
            throw bad(".pen ファイルの形式が不正です（children がありません）");
        }
        List<PenFrame> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (JsonNode n : children) {
            String id = n.path("id").asText("");
            if (!"frame".equals(n.path("type").asText()) || n.path("reusable").asBoolean(false)
                || id.isEmpty() || id.length() > 200 || !seen.add(id)) {
                continue;
            }
            String name = n.path("name").asText("").strip();
            out.add(new PenFrame(id, name.isEmpty() ? id : name.length() > 200 ? name.substring(0, 200) : name));
        }
        return out;
    }

    public static String sha256Hex(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static JsonNode zoom(JsonNode v) {
        JsonNode value = v.get("value");
        ObjectNode z = OM.createObjectNode();
        z.put("value", value != null && value.isNumber() ? value.asDouble() : 1.0);
        return z;
    }

    private static ObjectNode image(String fileId, JsonNode f, Limits limits) {
        String mime = f.path("mimeType").asText("");
        String dataUrl = f.path("dataURL").asText("");
        if (!IMAGE_MIME.contains(mime)) {
            throw bad("この画像形式は保存できません（" + mime + "）。PNG / JPEG / GIF / WebP を使ってください");
        }
        String prefix = "data:" + mime + ";base64,";
        if (!dataUrl.startsWith(prefix)) {
            throw bad("画像データの形式が不正です（" + fileId + "）");
        }
        String encoded = dataUrl.substring(prefix.length());
        if (encoded.length() > 4L * ((limits.maxImageBytes() + 2L) / 3L)) {
            throw bad("画像が大きすぎます（1 枚 " + mb(limits.maxImageBytes()) + " まで）");
        }
        byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException e) {
            throw bad("画像データの base64 が不正です（" + fileId + "）");
        }
        if (decoded.length > limits.maxImageBytes()) {
            throw bad("画像が大きすぎます（1 枚 " + mb(limits.maxImageBytes()) + " まで）");
        }
        validateImageHeader(decoded, mime);
        ObjectNode o = OM.createObjectNode();
        o.put("id", fileId);
        o.put("mimeType", mime);
        o.put("dataURL", dataUrl);
        JsonNode created = f.get("created");
        o.put("created", created != null && created.isNumber() ? created.asLong() : 0L);
        return o;
    }

    private static void validateImageHeader(byte[] raw, String mime) {
        int width;
        int height;
        if ("image/webp".equals(mime)) {
            int[] size = webpSize(raw);
            width = size[0];
            height = size[1];
        } else {
            try (MemoryCacheImageInputStream input = new MemoryCacheImageInputStream(new ByteArrayInputStream(raw))) {
                Iterator<ImageReader> readers = ImageIO.getImageReaders(input);
                if (!readers.hasNext()) throw bad("画像のヘッダーが不正です。画像を貼り直してください");
                ImageReader reader = readers.next();
                try {
                    String format = reader.getFormatName().toLowerCase(Locale.ROOT);
                    String actualMime = "image/" + ("jpg".equals(format) ? "jpeg" : format);
                    if (!mime.equals(actualMime)) throw bad("画像の実際の形式と MIME が一致しません");
                    reader.setInput(input, true, true);
                    width = reader.getWidth(0);
                    height = reader.getHeight(0);
                } finally {
                    reader.dispose();
                }
            } catch (IOException | IllegalArgumentException e) {
                throw bad("画像のヘッダーが不正です。画像を貼り直してください");
            }
        }
        if (width <= 0 || height <= 0 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE
            || (long) width * height > MAX_IMAGE_PIXELS) {
            throw bad("画像の寸法が大きすぎます（最大 4000 万画素・一辺 32768px）。縮小してから貼り直してください");
        }
    }

    /** JDK ImageIO に WebP reader がない環境でも、RIFF / VP8 系の寸法を割当なしで検証する。 */
    private static int[] webpSize(byte[] raw) {
        if (raw.length < 25 || !ascii(raw, 0, "RIFF") || !ascii(raw, 8, "WEBP")
            || unsignedLe(raw, 4, 4) + 8 != raw.length) {
            throw bad("WebP 画像のヘッダーが不正です");
        }
        long chunkSize = unsignedLe(raw, 16, 4);
        if (20 + chunkSize > raw.length) throw bad("WebP 画像が途中で切れています");
        if (ascii(raw, 12, "VP8X") && chunkSize >= 10 && raw.length >= 30) {
            return new int[]{1 + (int) unsignedLe(raw, 24, 3), 1 + (int) unsignedLe(raw, 27, 3)};
        }
        if (ascii(raw, 12, "VP8L") && chunkSize >= 5 && (raw[20] & 255) == 47) {
            int bits = (int) unsignedLe(raw, 21, 4);
            return new int[]{1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)};
        }
        if (ascii(raw, 12, "VP8 ") && chunkSize >= 10 && raw.length >= 30
            && (raw[23] & 255) == 157 && raw[24] == 1 && raw[25] == 42) {
            return new int[]{(int) unsignedLe(raw, 26, 2) & 0x3fff, (int) unsignedLe(raw, 28, 2) & 0x3fff};
        }
        throw bad("WebP 画像のヘッダーが不正です");
    }

    private static boolean ascii(byte[] raw, int offset, String value) {
        if (offset + value.length() > raw.length) return false;
        for (int i = 0; i < value.length(); i++) if (raw[offset + i] != value.charAt(i)) return false;
        return true;
    }

    private static long unsignedLe(byte[] raw, int offset, int bytes) {
        long n = 0;
        for (int i = 0; i < bytes; i++) n |= (long) (raw[offset + i] & 255) << (8 * i);
        return n;
    }

    private static BizException tooLarge(int maxBytes) {
        return bad("データが大きすぎます（画像込みで " + mb(maxBytes) + " まで）。画像を縮小するか枚数を減らしてください");
    }

    private static BizException penTooLarge(int maxBytes) {
        return bad(".pen ファイルが大きすぎます（" + mb(maxBytes) + " まで）");
    }

    private static String mb(int bytes) {
        return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024) + "MB" : (bytes / 1024) + "KB";
    }

    private static BizException bad(String msg) {
        return BizException.of(400, msg);
    }
}

package ai.proyubi.pm.service;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 资料 URL 识别（纯函数，无 Spring 依赖，便于单测）。
 * 规则见 doc/design/pm-drive-docs.md §3：按 host + path 判定 provider / kind / externalId，
 * 并据此计算官方嵌入 previewUrl（不落库）。Google 域解析不出合法 id 时降级为 kind=link。
 * <p>
 * 不用 {@link java.net.URI}：用户粘贴的 URL 常含未转义字符（空格、日文等），URI 会直接抛错；
 * 这里手工切分 scheme / host / path / query，只要 host 能取出就能判定。
 *
 */
public final class PmDocUrlParser {

    public static final String PROVIDER_GOOGLE = "google";
    public static final String PROVIDER_MICROSOFT = "microsoft";
    public static final String PROVIDER_BOX = "box";
    public static final String PROVIDER_OTHER = "other";

    public static final String KIND_GDOC = "gdoc";
    public static final String KIND_GSHEET = "gsheet";
    public static final String KIND_GSLIDE = "gslide";
    public static final String KIND_GFILE = "gfile";
    public static final String KIND_GFOLDER = "gfolder";
    public static final String KIND_MS = "ms";
    public static final String KIND_BOX = "box";
    public static final String KIND_LINK = "link";

    /** Google 文件/文件夹 id 只接受这些字符 */
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]+");

    /** docs.google.com/{document|spreadsheets|presentation}[/u/N]/d/{id}[/...] */
    private static final Pattern DOCS_PATH =
        Pattern.compile("^/(document|spreadsheets|presentation)(?:/u/\\d+)?/d/([^/]+)(?:/.*)?$");
    /** drive.google.com/file[/u/N]/d/{id}[/...] */
    private static final Pattern DRIVE_FILE_PATH =
        Pattern.compile("^/file(?:/u/\\d+)?/d/([^/]+)(?:/.*)?$");
    /** drive.google.com/drive[/u/N]/folders/{id}[/...] */
    private static final Pattern DRIVE_FOLDER_PATH =
        Pattern.compile("^/drive(?:/u/\\d+)?/folders/([^/]+)(?:/.*)?$");

    private PmDocUrlParser() {
    }

    /** 识别结果。externalId 仅 Google 且解析成功时非 null。 */
    public record Result(String provider, String kind, String externalId) {
        public String previewUrl() {
            return PmDocUrlParser.previewUrl(kind, externalId);
        }
    }

    /** 识别 URL。url 为 null / 取不出 host 时按 other/link 处理（合法性由调用方先校验）。 */
    public static Result parse(String url) {
        if (url == null) {
            return other();
        }
        String rest = url.trim();
        int schemeEnd = rest.indexOf("://");
        if (schemeEnd < 0) {
            return other();
        }
        rest = rest.substring(schemeEnd + 3);

        // authority = 到第一个 / ? # 为止
        int authEnd = indexOfAny(rest, "/?#");
        String authority = authEnd < 0 ? rest : rest.substring(0, authEnd);
        String afterAuth = authEnd < 0 ? "" : rest.substring(authEnd);
        int at = authority.lastIndexOf('@');
        if (at >= 0) {
            authority = authority.substring(at + 1);
        }
        int colon = authority.indexOf(':');
        String host = (colon >= 0 ? authority.substring(0, colon) : authority).toLowerCase(Locale.ROOT);
        if (host.endsWith(".")) {
            host = host.substring(0, host.length() - 1);
        }
        if (host.isEmpty()) {
            return other();
        }

        int hash = afterAuth.indexOf('#');
        if (hash >= 0) {
            afterAuth = afterAuth.substring(0, hash);
        }
        int q = afterAuth.indexOf('?');
        String path = q >= 0 ? afterAuth.substring(0, q) : afterAuth;
        String query = q >= 0 ? afterAuth.substring(q + 1) : "";

        if (isDomain(host, "google.com")) {
            return parseGoogle(host, path, query);
        }
        if (isDomain(host, "sharepoint.com") || host.equals("onedrive.live.com") || host.equals("1drv.ms")) {
            return new Result(PROVIDER_MICROSOFT, KIND_MS, null);
        }
        if (isDomain(host, "box.com")) {
            return new Result(PROVIDER_BOX, KIND_BOX, null);
        }
        return other();
    }

    /** 按 kind + externalId 计算官方嵌入 URL；不可预览返回 null。 */
    public static String previewUrl(String kind, String externalId) {
        if (kind == null || externalId == null || !ID.matcher(externalId).matches()) {
            return null;
        }
        return switch (kind) {
            case KIND_GDOC -> "https://docs.google.com/document/d/" + externalId + "/preview";
            case KIND_GSHEET -> "https://docs.google.com/spreadsheets/d/" + externalId + "/preview";
            case KIND_GSLIDE -> "https://docs.google.com/presentation/d/" + externalId + "/preview";
            case KIND_GFILE -> "https://drive.google.com/file/d/" + externalId + "/preview";
            case KIND_GFOLDER -> "https://drive.google.com/embeddedfolderview?id=" + externalId + "#list";
            default -> null;
        };
    }

    private static Result parseGoogle(String host, String path, String query) {
        if (host.equals("docs.google.com")) {
            Matcher m = DOCS_PATH.matcher(path);
            if (m.matches() && validId(m.group(2))) {
                String kind = switch (m.group(1)) {
                    case "document" -> KIND_GDOC;
                    case "spreadsheets" -> KIND_GSHEET;
                    default -> KIND_GSLIDE;
                };
                return new Result(PROVIDER_GOOGLE, kind, m.group(2));
            }
        } else if (host.equals("drive.google.com")) {
            Matcher f = DRIVE_FILE_PATH.matcher(path);
            if (f.matches() && validId(f.group(1))) {
                return new Result(PROVIDER_GOOGLE, KIND_GFILE, f.group(1));
            }
            Matcher d = DRIVE_FOLDER_PATH.matcher(path);
            if (d.matches() && validId(d.group(1))) {
                return new Result(PROVIDER_GOOGLE, KIND_GFOLDER, d.group(1));
            }
            if (path.equals("/open") || path.equals("/uc")) {
                String id = queryParam(query, "id");
                if (validId(id)) {
                    return new Result(PROVIDER_GOOGLE, KIND_GFILE, id);
                }
            }
        }
        // Google 域但解析不出 id → 降级为链接
        return new Result(PROVIDER_GOOGLE, KIND_LINK, null);
    }

    private static Result other() {
        return new Result(PROVIDER_OTHER, KIND_LINK, null);
    }

    /** host 等于 domain 或是其子域（防 google.com.evil.example 之类伪装） */
    private static boolean isDomain(String host, String domain) {
        return host.equals(domain) || host.endsWith("." + domain);
    }

    private static boolean validId(String id) {
        return id != null && ID.matcher(id).matches();
    }

    private static String queryParam(String query, String name) {
        if (query.isEmpty()) {
            return null;
        }
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals(name)) {
                return pair.substring(eq + 1);
            }
        }
        return null;
    }

    private static int indexOfAny(String s, String chars) {
        for (int i = 0; i < s.length(); i++) {
            if (chars.indexOf(s.charAt(i)) >= 0) {
                return i;
            }
        }
        return -1;
    }
}

package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * OpenPencil ビューア用のフォント取得プロキシ。
 * ブラウザ内の OpenPencil は .pen が使う Web フォント（日本語の Noto Sans JP など）を Google Fonts / Fontsource から
 * 取るが、fonts.google.com のメタデータは CORS ヘッダーを返さないため、ブラウザから直接は読めない。
 * .pen の icon（lucide 等）を描くための Iconify のアイコンデータ（api.iconify.design）も同じ経路で取る。
 * <ul>
 *   <li>https のみ、ホストは {@link #ALLOWED_HOSTS} の完全一致のみ（SSRF 防止）。リダイレクトは追わない。</li>
 *   <li>応答は 20MiB まで。GET 以外・クエリ以外の入力は受け付けない。</li>
 *   <li>成功応答はメモリに LRU で保持（合計 64MiB）。フォントは不変なので同じ URL は再取得しない。</li>
 * </ul>
 *
 */
@Service
public class PmDesignFontProxy {

    static final Set<String> ALLOWED_HOSTS = Set.of(
        "fonts.google.com", "fonts.googleapis.com", "fonts.gstatic.com", "api.fontsource.org", "cdn.jsdelivr.net",
        // .pen の icon（lucide 等）を描くための Iconify のアイコンデータ
        "api.iconify.design");
    private static final int MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
    private static final long MAX_CACHE_BYTES = 64L * 1024 * 1024;

    public record Fetched(int status, String contentType, byte[] body) {
    }

    private final HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();

    private final Map<String, Fetched> cache = new LinkedHashMap<>(64, 0.75f, true);
    private long cacheBytes;

    /** 許可された URL なら正規化した URI、そうでなければ 400。 */
    static URI allowed(String url) {
        URI uri;
        try {
            uri = url == null ? null : new URI(url);
        } catch (Exception e) {
            uri = null;
        }
        if (uri == null || !"https".equals(uri.getScheme()) || uri.getRawUserInfo() != null
            || uri.getPort() != -1 || uri.getHost() == null || !ALLOWED_HOSTS.contains(uri.getHost())) {
            throw BizException.of(400, "このフォント URL は取得できません");
        }
        return uri;
    }

    /** UA を見て応答を変えるのは Google Fonts の CSS だけ。他のホストは UA を固定してキャッシュを共有する */
    private static final String UA_SENSITIVE_HOST = "fonts.googleapis.com";
    private static final String DEFAULT_UA = "Mozilla/5.0";
    private static final int MAX_UA_LENGTH = 256;

    /** クライアント指定の UA は印字可能 ASCII・256 文字までのみ（ヘッダー注入・キャッシュ汚染の防止）。不正なら 400 */
    static String validUserAgent(String userAgent) {
        if (userAgent == null || userAgent.isBlank()) {
            return null;
        }
        if (userAgent.length() > MAX_UA_LENGTH || !userAgent.chars().allMatch(c -> c >= 0x20 && c < 0x7f)) {
            throw BizException.of(400, "User-Agent が不正です");
        }
        return userAgent;
    }

    public Fetched fetch(String url, String userAgent) {
        URI uri = allowed(url);
        // Google Fonts の CSS は UA で woff2 / ttf を出し分けるので UA ごとにキャッシュする
        String ua = UA_SENSITIVE_HOST.equals(uri.getHost()) ? validUserAgent(userAgent) : null;
        String key = (ua == null ? "" : ua) + "\n" + uri;
        synchronized (cache) {
            Fetched hit = cache.get(key);
            if (hit != null) {
                return hit;
            }
        }
        HttpRequest req = HttpRequest.newBuilder(uri)
            .timeout(Duration.ofSeconds(20))
            .header("User-Agent", ua == null ? DEFAULT_UA : ua)
            .GET().build();
        Fetched out;
        try {
            HttpResponse<InputStream> res = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
            byte[] body;
            try (InputStream in = res.body()) {
                body = in.readNBytes(MAX_RESPONSE_BYTES + 1);
            }
            if (body.length > MAX_RESPONSE_BYTES) {
                throw BizException.of(502, "フォントが大きすぎます");
            }
            out = new Fetched(res.statusCode(),
                res.headers().firstValue("Content-Type").orElse("application/octet-stream"), body);
        } catch (IOException e) {
            throw BizException.of(502, "フォントを取得できませんでした");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw BizException.of(502, "フォントを取得できませんでした");
        }
        if (out.status() == 200) {
            synchronized (cache) {
                // 同じキーを並行で取りに行った場合、上書きされる側の大きさを差し引く
                Fetched replaced = cache.put(key, out);
                if (replaced != null) {
                    cacheBytes -= replaced.body().length;
                }
                cacheBytes += out.body().length;
                var it = cache.entrySet().iterator();
                while (cacheBytes > MAX_CACHE_BYTES && it.hasNext()) {
                    cacheBytes -= it.next().getValue().body().length;
                    it.remove();
                }
            }
        }
        return out;
    }
}

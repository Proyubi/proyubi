package ai.proyubi.pm.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

/**
 * モックアップ原文 URL の署名と検証、および配信まわりの設定値。
 *
 * <p>原文は {@code {raw-base-url}/mock/m/{versionId}/{exp}/{sig}/{入口パス}} で配る（exp = epoch 秒、sig = HMAC）。
 * 署名をクエリではなくパスに入れるのは、zip 公開の効果図が {@code img/a.png} のような相対パスで
 * 付属ファイルを参照するため（クエリは相対解決で落ちるが、パスの接頭辞は引き継がれる）。
 * 署名は版単位なので、同じ接頭辞の下の全ファイル・全ページに同じ署名が効く。
 * 旧形式 {@code /mock/m/{versionId}?exp&sig} も検証は同じ（発行済み URL の互換用）。</p>
 * raw-base-url は PM と同一ドメインでもよい（prod = pm.example.com）。効果図の JS が PM の
 * localStorage（ログイントークン）を読めないのは、{@code PmMockupPublicController#secured} が返す
 * CSP sandbox（allow-same-origin なし）で opaque origin に閉じ込めているから。あのヘッダーを外すと即 XSS。</p>
 *
 * <p>sign-secret 未設定時は起動ごとにランダム生成する（再起動で旧 URL が無効になるだけなので dev 向け）。</p>
 *
 */
@Component
public class PmMockupUrlSigner {

    private static final Logger log = LoggerFactory.getLogger(PmMockupUrlSigner.class);
    private static final String HMAC = "HmacSHA256";

    private final byte[] secret;
    private final String rawBaseUrl;
    private final String webBaseUrl;
    private final String frameAncestors;

    public PmMockupUrlSigner(@Value("${proyubi.pm.mockup.sign-secret:}") String secret,
                             @Value("${proyubi.pm.mockup.raw-base-url:http://localhost:38082}") String rawBaseUrl,
                             @Value("${proyubi.pm.mockup.web-base-url:https://pm.example.com}") String webBaseUrl,
                             @Value("${proyubi.pm.mockup.frame-ancestors:https://pm.example.com https://pm.example.com http://localhost:8000}")
                             String frameAncestors) {
        if (secret == null || secret.isBlank()) {
            byte[] random = new byte[32];
            new SecureRandom().nextBytes(random);
            this.secret = random;
            log.warn("proyubi.pm.mockup.sign-secret 未設定：起動ごとのランダム鍵を使用（再起動でモックアップ URL が無効化される）");
        } else {
            this.secret = secret.getBytes(StandardCharsets.UTF_8);
        }
        this.rawBaseUrl = trimSlash(rawBaseUrl);
        this.webBaseUrl = trimSlash(webBaseUrl);
        this.frameAncestors = frameAncestors.trim();
    }

    /** 署名付き原文 URL を発行する。entryPath = 入口 HTML の版内パス（例 index.html）。 */
    public String sign(UUID versionId, Instant expiresAt, String entryPath) {
        long exp = expiresAt.getEpochSecond();
        return rawBaseUrl + "/mock/m/" + versionId + "/" + exp + "/" + mac(versionId, exp) + "/" + encodePath(entryPath);
    }

    /** 署名と期限を検証する。 */
    public boolean verify(UUID versionId, long exp, String sig) {
        if (sig == null || exp < Instant.now().getEpochSecond()) {
            return false;
        }
        byte[] expected = mac(versionId, exp).getBytes(StandardCharsets.US_ASCII);
        return MessageDigest.isEqual(expected, sig.getBytes(StandardCharsets.US_ASCII));
    }

    /** PM 画面の基底 URL（MCP の応答に載せる appUrl / shareUrl 用）。 */
    public String webBaseUrl() {
        return webBaseUrl;
    }

    /** CSP frame-ancestors に入れる origin 列（空白区切り）。 */
    public String frameAncestors() {
        return frameAncestors;
    }

    /** 共有トークン：URL セーフな 128bit 乱数。 */
    public static String newShareToken() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    /** SHA-256（hex） */
    public static String sha256Hex(byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private String mac(UUID versionId, long exp) {
        try {
            Mac m = Mac.getInstance(HMAC);
            m.init(new SecretKeySpec(secret, HMAC));
            byte[] out = m.doFinal((versionId + "." + exp).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(out);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** パスを区切りごとに URL エンコード（/ は残す、空白は %20）。 */
    static String encodePath(String path) {
        StringBuilder sb = new StringBuilder();
        for (String seg : path.split("/", -1)) {
            if (!sb.isEmpty()) {
                sb.append('/');
            }
            sb.append(URLEncoder.encode(seg, StandardCharsets.UTF_8).replace("+", "%20"));
        }
        return sb.toString();
    }

    private static String trimSlash(String s) {
        String t = s == null ? "" : s.trim();
        return t.endsWith("/") ? t.substring(0, t.length() - 1) : t;
    }
}

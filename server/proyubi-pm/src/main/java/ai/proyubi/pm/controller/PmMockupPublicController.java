package ai.proyubi.pm.controller;

import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmMockupBundle;
import ai.proyubi.pm.service.PmMockupService;
import ai.proyubi.pm.service.PmMockupUrlSigner;
import ai.proyubi.pm.vo.PmMockupVO;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * モックアップの公開エンドポイント（ログイン不要）。
 * <ul>
 *   <li>{@code GET /app/public/pm/mockups/share/{token}} — 共有ページ用メタ + 署名付き原文 URL。
 *       無効・停止・期限切れ・削除済みは区別せず 404（案件の存在すら漏らさない）。</li>
 *   <li>{@code GET /mock/m/{versionId}/{exp}/{sig}/{path}} — 原文（アップロードされた任意の HTML/JS と zip の付属ファイル）。
 *       旧形式 {@code /mock/m/{versionId}?exp&sig} も入口 HTML だけ返す。
 *       配信元は {@code proyubi.pm.mockup.raw-base-url}（別ドメインでも PM と同一ドメインでもよい）。
 *       CSP sandbox により opaque origin で動かす（直接開かれても PM のトークンには触れられない）。
 *       <b>PM と同一ドメインで配る場合、この CSP ヘッダーが唯一の防御</b> —— {@link #secured} のコメント参照。</li>
 * </ul>
 * 設計：doc/design/pm-mockup.md
 *
 */
@RestController
public class PmMockupPublicController {

    private static final MediaType HTML_UTF8 = new MediaType("text", "html", StandardCharsets.UTF_8);

    private final PmMockupService mockupService;
    private final PmMockupUrlSigner signer;

    public PmMockupPublicController(PmMockupService mockupService, PmMockupUrlSigner signer) {
        this.mockupService = mockupService;
        this.signer = signer;
    }

    @GetMapping("/app/public/pm/mockups/share/{token}")
    public R<PmMockupVO.PublicShare> share(@PathVariable String token) {
        PmMockupVO.PublicShare share = mockupService.publicShare(token);
        if (share == null) {
            return R.fail(404, "このリンクは無効です");
        }
        return R.ok(share);
    }

    /**
     * 原文配信（zip の付属ファイル・入口以外のページを含む）。署名は版単位で、パスに入れてある
     * （相対パス参照 {@code img/a.png} が同じ署名接頭辞の下に解決されるように）。
     * 末尾 / なしの版ルートは / 付きへリダイレクト（相対パスの基準をそろえる）。
     */
    @GetMapping("/mock/m/{versionId}/{exp}/{sig}/{*path}")
    public ResponseEntity<byte[]> file(@PathVariable UUID versionId, @PathVariable long exp,
                                       @PathVariable String sig, @PathVariable String path,
                                       HttpServletRequest request) {
        if (!signer.verify(versionId, exp, sig)) {
            return plain(HttpStatus.FORBIDDEN, "This link has expired. Please reopen it from PM.");
        }
        if (path.isEmpty() && !request.getRequestURI().endsWith("/")) {
            return ResponseEntity.status(HttpStatus.FOUND)
                .header(HttpHeaders.LOCATION, request.getRequestURI() + "/")
                .build();
        }
        String normalized = PmMockupBundle.normalizeRequestPath(path);
        PmMockupService.Served served = normalized == null ? null : mockupService.loadFile(versionId, normalized);
        if (served == null) {
            return plain(HttpStatus.NOT_FOUND, "Not found");
        }
        ResponseEntity.BodyBuilder res = secured(ResponseEntity.ok())
            .contentType(MediaType.parseMediaType(served.contentType()));
        if (!PmMockupBundle.isHtml(normalized)) {
            // sandbox（allow-same-origin なし）の文書は Origin: null になり、module script / fetch / フォントは
            // CORS 扱いになる。付属ファイルは署名 URL を知っている人しか取れないので * で問題ない。
            // HTML には付けない（付けても害はないが、文書を他オリジンから読ませる理由がない）。
            res.header(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "*");
        }
        return res.body(served.body());
    }

    /** 旧形式 {@code /mock/m/{versionId}?exp&sig}（入口 HTML のみ）。発行済み URL の互換用。 */
    @GetMapping("/mock/m/{versionId}")
    public ResponseEntity<byte[]> raw(@PathVariable UUID versionId,
                                      @RequestParam(required = false) Long exp,
                                      @RequestParam(required = false) String sig) {
        if (exp == null || !signer.verify(versionId, exp, sig)) {
            return plain(HttpStatus.FORBIDDEN, "This link has expired. Please reopen it from PM.");
        }
        String html = mockupService.loadContent(versionId);
        if (html == null) {
            return plain(HttpStatus.NOT_FOUND, "Not found");
        }
        return secured(ResponseEntity.ok())
            .contentType(HTML_UTF8)
            .body(html.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 原文レスポンス共通のセキュリティヘッダー。HTML・画像・SVG・JS すべてに付ける。
     */
    private ResponseEntity.BodyBuilder secured(ResponseEntity.BodyBuilder b) {
        // ⚠️ セキュリティ上の要。ここを変更する前に必ず読むこと。
        // 中身は第三者（Claude Code / Codex / Claude Design の出力など）が書いた任意の HTML/JS/SVG で、検査していない。
        // 安全なのは下の CSP "sandbox"（allow-same-origin なし）で opaque origin に閉じ込めているから：
        //   - PM の localStorage（ログイントークン）・cookie を読めない
        //   - /api を認証付きで叩いても応答を読めない（cross-origin 扱い）
        //   - Service Worker を登録できない
        // zip の付属ファイル（SVG を直接開く、入口以外の HTML へ遷移する等）も同じ扱いにするため全レスポンスに付ける。
        // 変更した場合の影響：
        //   - CSP ヘッダーを消す / sandbox を外す / allow-same-origin を足す
        //       → 効果図の JS が配信元ドメインの権限で動く。raw-base-url が PM と同一ドメイン
        //         （例 pm.example.com）だと、効果図を開いた人のトークンが盗まれる＝ストアド XSS。
        //         別ドメインでも、そのドメインの他コンテンツは同じ危険にさらされる。
        //   - allow-top-navigation を足す → 効果図が PM 画面ごと偽ログインページ等へ遷移できる（フィッシング）。
        //   - frame-ancestors を消す / '*' にする → 任意サイトに iframe 埋め込みされる（クリックジャッキング）。
        //       許可 origin は PM_MOCKUP_FRAME_ANCESTORS で足す。ここを緩めない。
        //   - allow-scripts / allow-forms / allow-popups / allow-modals / allow-downloads を外す
        //       → 安全側だが、効果図の操作・alert・ダウンロードが動かなくなる（機能劣化のみ）。
        //   - X-Content-Type-Options / Content-Type を変える → ブラウザの MIME 推測で別種として解釈されうる。
        //       Content-Type はアップロード時に拡張子のホワイトリストから決めている（PmMockupBundle）。
        //   - Cache-Control を public にする → 署名期限後も CDN/プロキシに残る。private のままにする。
        // HTML の <meta http-equiv="Content-Security-Policy"> は sandbox を指定できないため、
        // アップロード時の内容チェックでは代替できない。必ずレスポンスヘッダーで付けること。
        return b
            .header("Content-Security-Policy",
                "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; frame-ancestors "
                    + signer.frameAncestors())
            .header("X-Robots-Tag", "noindex, nofollow")
            .header("Referrer-Policy", "no-referrer")
            .header("X-Content-Type-Options", "nosniff")
            .header(HttpHeaders.CACHE_CONTROL, "private, max-age=300");
    }

    private static ResponseEntity<byte[]> plain(HttpStatus status, String msg) {
        return ResponseEntity.status(status)
            .contentType(new MediaType("text", "plain", StandardCharsets.UTF_8))
            .header("X-Robots-Tag", "noindex, nofollow")
            .body(msg.getBytes(StandardCharsets.UTF_8));
    }
}

package ai.proyubi.pm.controller;

import ai.proyubi.pm.service.PmDesignFontProxy;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * OpenPencil ビューアのフォント取得プロキシ（ログイン必須、許可ホストのみ）。詳細は {@link PmDesignFontProxy}。
 *
 */
@RestController
@RequestMapping("/app/pm/design-fonts")
public class PmDesignFontController {

    private final PmDesignFontProxy fontProxy;

    public PmDesignFontController(PmDesignFontProxy fontProxy) {
        this.fontProxy = fontProxy;
    }

    @GetMapping
    public ResponseEntity<byte[]> fetch(@RequestParam String url,
                                        @RequestParam(value = "ua", required = false) String fontUa,
                                        @RequestHeader(value = HttpHeaders.USER_AGENT, required = false) String ua) {
        // ブラウザの fetch は User-Agent を差し替えられないので、ビューアが指定した UA（ttf を返させる用）を優先する。
        // ヘッダーでなくクエリなのは、応答がブラウザにキャッシュされ UA 違いを取り違えないようにするため
        return respond(fontProxy.fetch(url, fontUa == null || fontUa.isBlank() ? ua : fontUa));
    }

    /** 本文で URL を受ける版。text= に文書の全文字を詰めた Google Fonts の CSS は GET の要求行（8KB）に収まらない */
    public record FetchReq(String url, String ua) {
    }

    @PostMapping
    public ResponseEntity<byte[]> fetchLong(@RequestBody FetchReq req,
                                            @RequestHeader(value = HttpHeaders.USER_AGENT, required = false) String ua) {
        return respond(fontProxy.fetch(req.url(), req.ua() == null || req.ua().isBlank() ? ua : req.ua()));
    }

    private ResponseEntity<byte[]> respond(PmDesignFontProxy.Fetched f) {
        // フォント・CSS・JSON 以外（HTML など）は API のオリジンで描画させない
        MediaType type;
        try {
            type = MediaType.parseMediaType(f.contentType());
        } catch (Exception e) {
            type = MediaType.APPLICATION_OCTET_STREAM;
        }
        String t = type.getType() + "/" + type.getSubtype();
        if (!t.startsWith("font/") && !t.equals("text/css") && !t.equals("application/json")
            && !t.startsWith("application/font") && !t.startsWith("application/x-font")) {
            type = MediaType.APPLICATION_OCTET_STREAM;
        }
        return ResponseEntity.status(f.status())
            .contentType(type)
            .header(HttpHeaders.CACHE_CONTROL, f.status() == 200 ? "private, max-age=86400" : "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .body(f.body());
    }
}

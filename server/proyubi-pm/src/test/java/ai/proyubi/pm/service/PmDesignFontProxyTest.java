package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * フォント取得プロキシの URL 許可判定（SSRF 防止）。ネットワークには出ない。
 */
class PmDesignFontProxyTest {

    @Test
    void allowsOnlyHttpsOnListedHosts() {
        assertEquals("fonts.gstatic.com",
            PmDesignFontProxy.allowed("https://fonts.gstatic.com/s/notosansjp/v1/a.woff2").getHost());
        assertEquals("fonts.google.com", PmDesignFontProxy.allowed("https://fonts.google.com/metadata/fonts").getHost());
    }

    @Test
    void rejectsOtherSchemesHostsPortsAndUserInfo() {
        for (String url : new String[]{
            null, "", "http://fonts.gstatic.com/a.woff2", "file:///etc/passwd", "https://example.com/a.woff2",
            "https://fonts.gstatic.com.evil.test/a", "https://evil.test/?h=fonts.gstatic.com",
            "https://fonts.gstatic.com:8443/a", "https://user@fonts.gstatic.com/a", "https://169.254.169.254/latest",
            "https://localhost/a", "not a url"}) {
            BizException e = assertThrows(BizException.class, () -> PmDesignFontProxy.allowed(url), String.valueOf(url));
            assertEquals(400, e.getCode());
        }
    }

    @Test
    void allowsIconifyApi() {
        assertEquals("api.iconify.design",
            PmDesignFontProxy.allowed("https://api.iconify.design/lucide.json?icons=x").getHost());
    }

    @Test
    void acceptsPrintableUserAgentsAndTreatsBlankAsAbsent() {
        String ttf = "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 "
            + "(KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";
        assertEquals(ttf, PmDesignFontProxy.validUserAgent(ttf));
        assertEquals(null, PmDesignFontProxy.validUserAgent(null));
        assertEquals(null, PmDesignFontProxy.validUserAgent(" "));
    }

    @Test
    void rejectsControlCharactersAndOverlongUserAgents() {
        for (String ua : new String[]{"a\r\nX-Evil: 1", "a\tb", "日本語", "a".repeat(257)}) {
            BizException e = assertThrows(BizException.class, () -> PmDesignFontProxy.validUserAgent(ua), ua);
            assertEquals(400, e.getCode());
        }
    }
}

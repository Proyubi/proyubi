package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PmMockupBundle：zip / ファイル一覧の展開規則（入口の決定・パスの安全性・上限）。設計：doc/design/pm-mockup.md §7
 */
class PmMockupBundleTest {

    private static final PmMockupBundle.Limits LIMITS = new PmMockupBundle.Limits(1024, 4096, 10);
    private static final String HTML = "<html><title>T</title><img src=\"img/a.png\"></html>";

    private static byte[] zip(Map<String, byte[]> files) {
        return zip(files, StandardCharsets.UTF_8);
    }

    private static byte[] zip(Map<String, byte[]> files, Charset charset) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipOutputStream out = new ZipOutputStream(bos, charset)) {
            for (Map.Entry<String, byte[]> e : files.entrySet()) {
                out.putNextEntry(new ZipEntry(e.getKey()));
                out.write(e.getValue());
                out.closeEntry();
            }
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return bos.toByteArray();
    }

    private static Map<String, byte[]> files(String... pathAndContent) {
        Map<String, byte[]> m = new LinkedHashMap<>();
        for (int i = 0; i < pathAndContent.length; i += 2) {
            m.put(pathAndContent[i], pathAndContent[i + 1].getBytes(StandardCharsets.UTF_8));
        }
        return m;
    }

    // ---- 入口と付属ファイル

    @Test
    void claudeDesignExport() {
        PmMockupBundle b = PmMockupBundle.ofZip(zip(files("index.html", HTML, "img/a.png", "PNG", "img/b.png", "PNG2")), LIMITS);
        assertEquals("index.html", b.entryPath());
        assertEquals(HTML, b.entryHtml());
        assertEquals(List.of("img/a.png", "img/b.png"), b.assets().stream().map(PmMockupBundle.Asset::path).toList());
        assertEquals("image/png", b.assets().get(0).contentType());
        assertEquals(3, b.fileCount());
        assertEquals(HTML.length() + 7, b.totalBytes());
    }

    @Test
    void stripsSingleTopFolderAndOsJunk() {
        PmMockupBundle b = PmMockupBundle.ofZip(zip(files(
            "DEMO/index.html", HTML, "DEMO/img/a.png", "PNG",
            "__MACOSX/DEMO/._index.html", "x", "DEMO/.DS_Store", "x", "DEMO/notes.psd", "x")), LIMITS);
        assertEquals("index.html", b.entryPath());
        assertEquals(List.of("img/a.png"), b.assets().stream().map(PmMockupBundle.Asset::path).toList());
    }

    @Test
    void entryFallsBackToSoleRootHtml() {
        PmMockupBundle b = PmMockupBundle.ofZip(zip(files("top.html", HTML, "pages/sub.html", HTML)), LIMITS);
        assertEquals("top.html", b.entryPath());
        assertEquals("pages/sub.html", b.assets().get(0).path());
        assertTrue(b.assets().get(0).contentType().startsWith("text/html"));
    }

    @Test
    void ambiguousEntryIsRejected() {
        BizException e = assertThrows(BizException.class,
            () -> PmMockupBundle.ofZip(zip(files("a.html", HTML, "b.html", HTML)), LIMITS));
        assertTrue(e.getMessage().contains("index.html"));
    }

    @Test
    void noHtmlIsRejected() {
        assertThrows(BizException.class, () -> PmMockupBundle.ofZip(zip(files("a.png", "x")), LIMITS));
    }

    // ---- パスの安全性

    @Test
    void zipSlipIsRejected() {
        assertThrows(BizException.class,
            () -> PmMockupBundle.ofZip(zip(files("index.html", HTML, "../evil.js", "x")), LIMITS));
        assertThrows(BizException.class,
            () -> PmMockupBundle.ofFiles(List.of(new PmMockupBundle.RawFile("/etc/x.js", new byte[1]),
                new PmMockupBundle.RawFile("index.html", HTML.getBytes(StandardCharsets.UTF_8))), LIMITS));
        assertThrows(BizException.class,
            () -> PmMockupBundle.ofFiles(List.of(new PmMockupBundle.RawFile("C:\\x\\index.html", new byte[1])), LIMITS));
    }

    @Test
    void requestPathNormalization() {
        assertEquals("index.html", PmMockupBundle.normalizeRequestPath("/"));
        assertEquals("index.html", PmMockupBundle.normalizeRequestPath(""));
        assertEquals("pages/index.html", PmMockupBundle.normalizeRequestPath("/pages/"));
        assertEquals("img/a.png", PmMockupBundle.normalizeRequestPath("/img/a.png"));
        assertNull(PmMockupBundle.normalizeRequestPath("/img/../../x"));
        // macOS の zip（NFD）で入っても HTML 側の NFC 参照で引ける
        String nfd = Normalizer.normalize("画像/がぞう.png", Normalizer.Form.NFD);
        PmMockupBundle b = PmMockupBundle.ofZip(zip(files("index.html", HTML, nfd, "x")), LIMITS);
        assertEquals("画像/がぞう.png", b.assets().get(0).path());
        assertEquals("画像/がぞう.png", PmMockupBundle.normalizeRequestPath("/" + nfd));
    }

    @Test
    void shiftJisFileNames() {
        PmMockupBundle b = PmMockupBundle.ofZip(zip(files("index.html", HTML, "画像.png", "x"), Charset.forName("MS932")), LIMITS);
        assertEquals("画像.png", b.assets().get(0).path());
    }

    // ---- 上限

    @Test
    void limits() {
        String big = "x".repeat(1500);
        assertThrows(BizException.class, () -> PmMockupBundle.ofZip(zip(files("index.html", big)), LIMITS));
        assertThrows(BizException.class, () -> PmMockupBundle.ofZip(zip(files(
            "index.html", HTML, "a.png", "y".repeat(2100), "b.png", "y".repeat(2100))), LIMITS));
        Map<String, byte[]> many = files("index.html", HTML);
        for (int i = 0; i < 10; i++) {
            many.put("img/" + i + ".png", new byte[1]);
        }
        assertThrows(BizException.class, () -> PmMockupBundle.ofZip(zip(many), LIMITS));
        assertThrows(BizException.class, () -> PmMockupBundle.ofZip("not a zip".getBytes(StandardCharsets.UTF_8), LIMITS));
    }

    @Test
    void ignoredEntriesStillCountTowardUnpackedLimit() {
        // ホワイトリスト外（.bin）は保存しないが、展開量の上限には数える（zip bomb で CPU を食わせない）
        assertThrows(BizException.class, () -> PmMockupBundle.ofZip(zip(files(
            "index.html", HTML, "junk.bin", "0".repeat(5000))), LIMITS));
    }

    @Test
    void nulInEntryHtmlIsRejected() {
        assertThrows(BizException.class, () -> PmMockupBundle.ofHtml("<html>\u0000</html>", LIMITS));
        assertThrows(BizException.class, () -> PmMockupBundle.ofZip(zip(files("index.html", "<p>\u0000</p>")), LIMITS));
    }

    // ---- 同一内容判定

    @Test
    void hashIsStableAndContentSensitive() {
        byte[] z1 = zip(files("index.html", HTML, "img/a.png", "PNG"));
        byte[] z2 = zip(files("img/a.png", "PNG", "index.html", HTML));
        assertEquals(PmMockupBundle.ofZip(z1, LIMITS).sha256(), PmMockupBundle.ofZip(z2, LIMITS).sha256());
        assertNotEquals(PmMockupBundle.ofZip(z1, LIMITS).sha256(),
            PmMockupBundle.ofZip(zip(files("index.html", HTML, "img/a.png", "PNG!")), LIMITS).sha256());
        // index.html だけの zip は単一 HTML と同じ扱い
        assertEquals(PmMockupBundle.ofHtml(HTML, LIMITS).sha256(),
            PmMockupBundle.ofZip(zip(files("index.html", HTML)), LIMITS).sha256());
    }

    @Test
    void contentTypeWhitelist() {
        assertEquals("image/svg+xml", PmMockupBundle.contentTypeOf("a/b.SVG"));
        assertEquals("text/javascript; charset=utf-8", PmMockupBundle.contentTypeOf("app.mjs"));
        assertNull(PmMockupBundle.contentTypeOf("run.exe"));
        assertNull(PmMockupBundle.contentTypeOf("dir.v1/README"));
    }
}

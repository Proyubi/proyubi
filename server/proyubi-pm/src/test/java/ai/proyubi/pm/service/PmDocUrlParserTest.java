package ai.proyubi.pm.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * PmDocUrlParser 识别契约测试。规则对应 doc/design/pm-drive-docs.md §3 的表格，逐行覆盖。
 */
class PmDocUrlParserTest {

    private static final String ID = "1AbC-d_EfG123";

    private static void assertParsed(String url, String provider, String kind, String externalId, String previewUrl) {
        PmDocUrlParser.Result r = PmDocUrlParser.parse(url);
        assertEquals(provider, r.provider(), "provider of " + url);
        assertEquals(kind, r.kind(), "kind of " + url);
        assertEquals(externalId, r.externalId(), "externalId of " + url);
        assertEquals(previewUrl, r.previewUrl(), "previewUrl of " + url);
    }

    // ---- Google ドキュメント / スプレッドシート / スライド

    @Test
    void googleDocument() {
        assertParsed("https://docs.google.com/document/d/" + ID + "/edit?usp=sharing",
            "google", "gdoc", ID, "https://docs.google.com/document/d/" + ID + "/preview");
    }

    @Test
    void googleSpreadsheet() {
        assertParsed("https://docs.google.com/spreadsheets/d/" + ID + "/edit#gid=0",
            "google", "gsheet", ID, "https://docs.google.com/spreadsheets/d/" + ID + "/preview");
    }

    @Test
    void googlePresentation() {
        assertParsed("https://docs.google.com/presentation/d/" + ID,
            "google", "gslide", ID, "https://docs.google.com/presentation/d/" + ID + "/preview");
    }

    @Test
    void googleDocumentWithAccountIndex() {
        assertParsed("https://docs.google.com/document/u/1/d/" + ID + "/edit",
            "google", "gdoc", ID, "https://docs.google.com/document/d/" + ID + "/preview");
    }

    // ---- Google ドライブ ファイル

    @Test
    void driveFile() {
        assertParsed("https://drive.google.com/file/d/" + ID + "/view?usp=drive_link",
            "google", "gfile", ID, "https://drive.google.com/file/d/" + ID + "/preview");
    }

    @Test
    void driveOpenId() {
        assertParsed("https://drive.google.com/open?id=" + ID,
            "google", "gfile", ID, "https://drive.google.com/file/d/" + ID + "/preview");
    }

    @Test
    void driveUcId() {
        assertParsed("https://drive.google.com/uc?export=download&id=" + ID,
            "google", "gfile", ID, "https://drive.google.com/file/d/" + ID + "/preview");
    }

    // ---- Google ドライブ フォルダ

    @Test
    void driveFolder() {
        assertParsed("https://drive.google.com/drive/folders/" + ID + "?usp=sharing",
            "google", "gfolder", ID, "https://drive.google.com/embeddedfolderview?id=" + ID + "#list");
    }

    @Test
    void driveFolderWithAccountIndex() {
        assertParsed("https://drive.google.com/drive/u/0/folders/" + ID,
            "google", "gfolder", ID, "https://drive.google.com/embeddedfolderview?id=" + ID + "#list");
    }

    // ---- Google 域だが id が不正 / 解析不能 → google + link

    @Test
    void googleInvalidIdFallsBackToLink() {
        assertParsed("https://docs.google.com/document/d/abc%3Cscript%3E/edit", "google", "link", null, null);
        assertParsed("https://drive.google.com/open?id=bad\"id", "google", "link", null, null);
        assertParsed("https://drive.google.com/open?id=", "google", "link", null, null);
        assertParsed("https://drive.google.com/drive/folders/", "google", "link", null, null);
    }

    @Test
    void googleUnknownPathFallsBackToLink() {
        assertParsed("https://drive.google.com/drive/my-drive", "google", "link", null, null);
        assertParsed("https://sites.google.com/view/foo", "google", "link", null, null);
    }

    // ---- Microsoft

    @Test
    void sharepoint() {
        assertParsed("https://contoso.sharepoint.com/:x:/s/team/EabcDEF?e=123", "microsoft", "ms", null, null);
    }

    @Test
    void onedrive() {
        assertParsed("https://onedrive.live.com/edit.aspx?resid=ABC", "microsoft", "ms", null, null);
        assertParsed("https://1drv.ms/x/s!AbCdEf", "microsoft", "ms", null, null);
    }

    // ---- Box

    @Test
    void box() {
        assertParsed("https://app.box.com/s/abcdef", "box", "box", null, null);
        assertParsed("https://box.com/s/abcdef", "box", "box", null, null);
        assertParsed("https://contoso.ent.box.com/folder/123", "box", "box", null, null);
    }

    // ---- その他

    @Test
    void otherLinks() {
        assertParsed("https://example.com/spec.pdf", "other", "link", null, null);
        assertParsed("http://intra.local:8080/docs/a.xlsx", "other", "link", null, null);
    }

    @Test
    void spoofedHostsAreOther() {
        assertParsed("https://docs.google.com.evil.example/document/d/" + ID, "other", "link", null, null);
        assertParsed("https://notbox.com/s/abc", "other", "link", null, null);
        assertParsed("https://evil.example/?u=https://docs.google.com/document/d/" + ID, "other", "link", null, null);
    }

    @Test
    void hostIsCaseInsensitiveAndIgnoresUserinfoAndPort() {
        assertParsed("https://user@DOCS.Google.com:443/document/d/" + ID + "/edit",
            "google", "gdoc", ID, "https://docs.google.com/document/d/" + ID + "/preview");
    }

    @Test
    void nullAndMalformed() {
        assertParsed(null, "other", "link", null, null);
        assertParsed("not a url", "other", "link", null, null);
    }

    @Test
    void previewUrlRejectsNonGoogleKindsAndBadIds() {
        assertNull(PmDocUrlParser.previewUrl("ms", ID));
        assertNull(PmDocUrlParser.previewUrl("gdoc", null));
        assertNull(PmDocUrlParser.previewUrl("gdoc", "a/b"));
    }
}

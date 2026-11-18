package ai.proyubi.pm.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import ai.proyubi.common.core.exception.BizException;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PmDesignContent：Excalidraw 場面の検証・整形と .pen 原文の無改変保存（requirements §4.2 / §4.3 / A5 / A6）。
 */
class PmDesignContentTest {

    private static final ObjectMapper OM = new ObjectMapper();
    private static final PmDesignContent.Limits LIMITS = new PmDesignContent.Limits(10 * 1024 * 1024, 5000, 5 * 1024 * 1024);
    /** 1x1 PNG */
    private static final String PNG_B64 =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    /** A1 相当：2 つの流程框 + 両端バインドの矢印 + 付箋（塗り矩形 + バインド文字）+ 画像 */
    static String flowScene() {
        return """
            {"type":"excalidraw","version":2,"source":"https://excalidraw.com",
             "elements":[
               {"id":"box1","type":"rectangle","x":0,"y":0,"width":100,"height":60,
                "boundElements":[{"id":"arrow1","type":"arrow"}]},
               {"id":"box2","type":"diamond","x":300,"y":0,"width":100,"height":60,
                "boundElements":[{"id":"arrow1","type":"arrow"}]},
               {"id":"arrow1","type":"arrow","x":100,"y":30,"points":[[0,0],[200,0]],
                "startBinding":{"elementId":"box1","focus":0,"gap":1},
                "endBinding":{"elementId":"box2","focus":0,"gap":1}},
               {"id":"note1","type":"rectangle","x":0,"y":200,"width":160,"height":100,
                "backgroundColor":"#ffec99","fillStyle":"solid","boundElements":[{"id":"noteText","type":"text"}]},
               {"id":"noteText","type":"text","x":10,"y":210,"text":"確認お願いします","containerId":"note1"},
               {"id":"shot1","type":"image","x":500,"y":0,"width":1,"height":1,"fileId":"file1","status":"saved"},
               {"id":"gone","type":"rectangle","x":0,"y":0,"isDeleted":true}
             ],
             "appState":{"viewBackgroundColor":"#ffffff","gridSize":20,"zoom":{"value":1.5},
               "scrollX":10,"scrollY":-5,"collaborators":{},"selectedElementIds":{"box1":true},
               "openDialog":null,"theme":"light"},
             "files":{
               "file1":{"id":"file1","mimeType":"image/png","dataURL":"data:image/png;base64,%s","created":1},
               "orphan":{"id":"orphan","mimeType":"image/png","dataURL":"data:image/png;base64,%s","created":1}
             }}
            """.formatted(PNG_B64, PNG_B64);
    }

    @Test
    void excalidrawKeepsShapesBindingsNoteAndImage() throws Exception {
        PmDesignContent.Normalized n = PmDesignContent.normalizeExcalidraw(flowScene(), LIMITS);
        JsonNode root = OM.readTree(n.content());
        assertEquals("excalidraw", root.get("type").asText());
        assertEquals("json", n.encoding());
        JsonNode els = root.get("elements");
        assertEquals(6, els.size(), "isDeleted 要素は落とし、残りは全て保持");
        JsonNode arrow = els.get(2);
        assertEquals("box1", arrow.get("startBinding").get("elementId").asText());
        assertEquals("box2", arrow.get("endBinding").get("elementId").asText());
        assertEquals("確認お願いします", els.get(4).get("text").asText());
        assertEquals("note1", els.get(4).get("containerId").asText());
        // 画像は data URL ごと保持（ID だけ残して再オープンで画像が消える事態を防ぐ）
        assertTrue(root.get("files").get("file1").get("dataURL").asText().endsWith(PNG_B64));
        assertFalse(root.get("files").has("orphan"), "参照されていない画像は保存しない");
    }

    @Test
    void excalidrawAppStateIsFilteredToSerializableAllowlist() throws Exception {
        JsonNode app = OM.readTree(PmDesignContent.normalizeExcalidraw(flowScene(), LIMITS).content()).get("appState");
        assertEquals("#ffffff", app.get("viewBackgroundColor").asText());
        assertEquals(1.5, app.get("zoom").get("value").asDouble());
        assertEquals(10, app.get("scrollX").asInt());
        assertFalse(app.has("collaborators"));
        assertFalse(app.has("selectedElementIds"));
        assertFalse(app.has("openDialog"));
    }

    @Test
    void excalidrawNormalizationIsStable() {
        PmDesignContent.Normalized once = PmDesignContent.normalizeExcalidraw(flowScene(), LIMITS);
        PmDesignContent.Normalized twice = PmDesignContent.normalizeExcalidraw(once.content(), LIMITS);
        assertEquals(once.content(), twice.content());
        assertEquals(once.sha256(), twice.sha256());
    }

    @Test
    void emptySceneIsValid() {
        PmDesignContent.Normalized n = PmDesignContent.normalizeExcalidraw(PmDesignContent.emptyScene(), LIMITS);
        assertTrue(n.content().contains("\"elements\":[]"));
    }

    @Test
    void rejectsInvalidJsonAndShape() {
        assertBad(() -> PmDesignContent.normalizeExcalidraw("{not json", LIMITS));
        assertBad(() -> PmDesignContent.normalizeExcalidraw("[]", LIMITS));
        assertBad(() -> PmDesignContent.normalizeExcalidraw("{\"elements\":{}}", LIMITS));
        assertBad(() -> PmDesignContent.normalizeExcalidraw("{\"elements\":[{\"type\":\"rectangle\"}]}", LIMITS));
        assertBad(() -> PmDesignContent.normalizeExcalidraw(null, LIMITS));
    }

    @Test
    void rejectsEmbeddableAndIframeElements() {
        assertBad(() -> PmDesignContent.normalizeExcalidraw(
            "{\"elements\":[{\"id\":\"e\",\"type\":\"embeddable\",\"link\":\"https://evil\"}]}", LIMITS));
        assertBad(() -> PmDesignContent.normalizeExcalidraw(
            "{\"elements\":[{\"id\":\"e\",\"type\":\"iframe\"}]}", LIMITS));
    }

    @Test
    void rejectsTooLargeOrTooManyElements() {
        PmDesignContent.Limits tiny = new PmDesignContent.Limits(200, 5000, 1024);
        assertBad(() -> PmDesignContent.normalizeExcalidraw(flowScene(), tiny));
        PmDesignContent.Limits few = new PmDesignContent.Limits(10 * 1024 * 1024, 2, 1024 * 1024);
        assertBad(() -> PmDesignContent.normalizeExcalidraw(flowScene(), few));
    }

    @Test
    void rejectsUnsafeOrMissingImages() {
        String svg = flowScene().replace("\"mimeType\":\"image/png\",\"dataURL\":\"data:image/png",
            "\"mimeType\":\"image/svg+xml\",\"dataURL\":\"data:image/svg+xml");
        assertBad(() -> PmDesignContent.normalizeExcalidraw(svg, LIMITS));
        String blob = flowScene().replaceFirst("data:image/png;base64,[A-Za-z0-9+/=]+", "blob:https://pm.example/123");
        assertBad(() -> PmDesignContent.normalizeExcalidraw(blob, LIMITS));
        String mismatch = flowScene().replaceFirst("data:image/png;", "data:image/jpeg;");
        assertBad(() -> PmDesignContent.normalizeExcalidraw(mismatch, LIMITS));
        String missing = flowScene().replace("\"fileId\":\"file1\"", "\"fileId\":\"nope\"");
        assertBad(() -> PmDesignContent.normalizeExcalidraw(missing, LIMITS));
        PmDesignContent.Limits smallImg = new PmDesignContent.Limits(10 * 1024 * 1024, 5000, 10);
        assertBad(() -> PmDesignContent.normalizeExcalidraw(flowScene(), smallImg));
    }

    @Test
    void penKeepsOriginalBytesExactly() {
        // 未知フィールド・改行・BOM 付きでも 1 バイトも変えない
        byte[] raw = "﻿{\"version\":\"2.6\",\"children\":[{\"type\":\"frame\",\"x-unknown\":{\"a\":1}}]}\r\n"
            .getBytes(StandardCharsets.UTF_8);
        String b64 = Base64.getEncoder().encodeToString(raw);
        PmDesignContent.Normalized n = PmDesignContent.normalizePen(b64, LIMITS);
        assertEquals("base64", n.encoding());
        assertEquals(b64, n.content());
        assertEquals(raw.length, n.sizeBytes());
        assertEquals(PmDesignContent.sha256Hex(raw), n.sha256());
    }

    @Test
    void penRejectsEmptyInvalidOrOversized() {
        assertBad(() -> PmDesignContent.normalizePen("", LIMITS));
        assertBad(() -> PmDesignContent.normalizePen("@@not base64@@", LIMITS));
        String big = Base64.getEncoder().encodeToString(new byte[300]);
        assertBad(() -> PmDesignContent.normalizePen(big, new PmDesignContent.Limits(100, 10, 10)));
    }

    @Test
    void rejectsEmptyOrNonImagePayload() {
        assertBad(() -> PmDesignContent.normalizeExcalidraw(flowScene().replace(PNG_B64, ""), LIMITS));
        assertBad(() -> PmDesignContent.normalizeExcalidraw(flowScene().replace(PNG_B64, "AAA="), LIMITS));
    }

    @Test
    void rejectsActualImageFormatDifferentFromDeclaredMime() {
        String fakeJpeg = flowScene().replace("image/png", "image/jpeg");
        assertBad(() -> PmDesignContent.normalizeExcalidraw(fakeJpeg, LIMITS));
    }

    @Test
    void rejectsImageWithHugePixelDimensionsWithoutDecodingPixels() {
        byte[] png = Base64.getDecoder().decode(PNG_B64);
        java.nio.ByteBuffer header = java.nio.ByteBuffer.wrap(png);
        header.putInt(16, 8192);
        header.putInt(20, 8192);
        java.util.zip.CRC32 crc = new java.util.zip.CRC32();
        crc.update(png, 12, 17);
        header.putInt(29, (int) crc.getValue());
        String huge = Base64.getEncoder().encodeToString(png);
        assertBad(() -> PmDesignContent.normalizeExcalidraw(flowScene().replace(PNG_B64, huge), LIMITS));
    }

    private static void assertBad(org.junit.jupiter.api.function.Executable ex) {
        BizException e = assertThrows(BizException.class, ex);
        assertEquals(400, e.getCode(), e.getMessage());
    }

    @Test
    void penFramesListsTopLevelFramesOnlyInOrder() {
        String json = "{\"version\":\"2.6\",\"children\":["
            + "{\"type\":\"frame\",\"id\":\"cmp\",\"name\":\"Button\",\"reusable\":true},"
            + "{\"type\":\"frame\",\"id\":\"W02\",\"name\":\"W02-01 学生一覧\","
            + "\"children\":[{\"type\":\"frame\",\"id\":\"inner\"}]},"
            + "{\"type\":\"rectangle\",\"id\":\"r\"},"
            + "{\"type\":\"frame\",\"id\":\"W04\"},"
            + "{\"type\":\"frame\",\"id\":\"W02\",\"name\":\"dup\"}]}";
        List<PmDesignContent.PenFrame> frames = PmDesignContent.penFrames(json.getBytes(StandardCharsets.UTF_8));
        assertEquals(List.of(new PmDesignContent.PenFrame("W02", "W02-01 学生一覧"),
            new PmDesignContent.PenFrame("W04", "W04")), frames, "コンポーネント・子・frame 以外・重複 id を除き、名前なしは id");
    }

    @Test
    void penFramesRejectsNonJson() {
        assertBad(() -> PmDesignContent.penFrames("PK\u0003\u0004".getBytes(StandardCharsets.UTF_8)));
        assertBad(() -> PmDesignContent.penFrames("{\"version\":\"1\"}".getBytes(StandardCharsets.UTF_8)));
    }
}

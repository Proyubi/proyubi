package ai.proyubi.pm.vo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import ai.proyubi.pm.controller.PmDocController;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PmDocVO / 请求体的 JSON 字段名契约（pm-web 按 isRoot 读写，不能被 Jackson 归一成 root）。
 */
class PmDocVOJsonTest {

    private final ObjectMapper om = new ObjectMapper().registerModule(new JavaTimeModule());

    @Test
    void voSerializesIsRoot() throws Exception {
        PmDocVO vo = new PmDocVO(UUID.randomUUID(), UUID.randomUUID(), null, null, "https://x", "other", "link",
            null, null, null, "application/pdf", true, List.of(new PmDocVO.TaskRef(UUID.randomUUID(), "t")), UUID.randomUUID(), "n",
            LocalDateTime.now());
        JsonNode n = om.readTree(om.writeValueAsString(vo));
        assertTrue(n.get("isRoot").asBoolean());
        assertFalse(n.has("root"));
        assertEquals("application/pdf", n.get("mimeType").asText());
        assertEquals("t", n.get("tasks").get(0).get("taskName").asText());
    }

    @Test
    void createReqReadsIsRoot() throws Exception {
        PmDocController.CreateReq req = om.readValue(
            "{\"customerId\":null,\"url\":\"https://x\",\"isRoot\":true,\"taskIds\":[]}", PmDocController.CreateReq.class);
        assertEquals(Boolean.TRUE, req.isRoot());
    }
}

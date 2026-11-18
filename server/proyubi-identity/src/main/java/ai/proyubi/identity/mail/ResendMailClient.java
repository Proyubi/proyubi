package ai.proyubi.identity.mail;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Resend HTTP API 客户端。文档：https://resend.com/docs/api-reference/emails/send-email
 *
 * <p>未配置 {@code mail.resend.api-key} 时 {@link #isEnabled()} 返回 false，由 MailService
 * 走其他兜底路径（SMTP / log-only），不抛异常。
 */
@Slf4j
@Component
public class ResendMailClient {

    private static final String API_URL = "https://api.resend.com/emails";

    private final String apiKey;
    private final HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public ResendMailClient(@Value("${mail.resend.api-key:}") String apiKey) {
        this.apiKey = apiKey;
    }

    public boolean isEnabled() {
        return apiKey != null && !apiKey.isBlank();
    }

    /**
     * 发送纯文本邮件。失败时返回 false 并记日志，不抛异常。
     *
     * @param from    发件人，建议带显示名："Proyubi <noreply@example.com>"
     * @param to      收件人邮箱
     * @param subject 主题
     * @param text    纯文本正文
     */
    public boolean sendText(String from, String to, String subject, String text) {
        if (!isEnabled()) {
            return false;
        }
        try {
            String body = objectMapper.writeValueAsString(Map.of(
                "from", from,
                "to", List.of(to),
                "subject", subject,
                "text", text
            ));
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(API_URL))
                .timeout(Duration.ofSeconds(15))
                .header("Authorization", "Bearer " + apiKey)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                return true;
            }
            log.error("Resend send failed: status={} to={} subject={} body={}",
                response.statusCode(), to, subject, response.body());
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("Resend send interrupted: to={} subject={}", to, subject, e);
            return false;
        } catch (Exception e) {
            log.error("Resend send error: to={} subject={}", to, subject, e);
            return false;
        }
    }
}

package ai.proyubi.identity.mail;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

/**
 * 极简邮件发送门面。优先级：Resend HTTP API → SMTP（JavaMailSender） → log-only。
 *
 * <ul>
 *   <li>配置 {@code mail.resend.api-key} → 走 Resend API（推荐，生产默认）</li>
 *   <li>否则配置 {@code spring.mail.host} → 走 SMTP</li>
 *   <li>都没配 → 把验证码 / 邮件正文打印到日志，便于本地联调，不抛异常、不阻塞业务</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MailService {

    /** 发送结果：调用方据此区分"真实失败"（FAILED）和"开发模式静默打日志"（DEV_LOGGED）。 */
    public enum SendResult {
        /** 真发了（Resend / SMTP 成功响应）。 */
        SENT,
        /** 没配发件渠道，正文写入日志；本地联调可直接看日志拿验证码。 */
        DEV_LOGGED,
        /** 配了发件渠道但调用失败（Resend HTTP 非 2xx / SMTP 异常等）。 */
        FAILED
    }

    private final ResendMailClient resendClient;
    private final ObjectProvider<JavaMailSender> mailSenderProvider;

    @Value("${mail.from:no-reply@proyubi.local}")
    private String fromAddress;

    /**
     * 发送纯文本邮件。失败仅记日志，不抛异常给上层；调用方按返回值决策。
     */
    public SendResult sendText(String to, String subject, String body) {
        if (resendClient.isEnabled()) {
            return resendClient.sendText(fromAddress, to, subject, body)
                ? SendResult.SENT
                : SendResult.FAILED;
        }
        JavaMailSender mailSender = mailSenderProvider.getIfAvailable();
        if (mailSender == null) {
            log.info("[DEV-MAIL] (no Resend / SMTP configured) to={} subject={}\n--- BODY ---\n{}\n------------",
                to, subject, body);
            return SendResult.DEV_LOGGED;
        }
        try {
            SimpleMailMessage msg = new SimpleMailMessage();
            msg.setFrom(fromAddress);
            msg.setTo(to);
            msg.setSubject(subject);
            msg.setText(body);
            mailSender.send(msg);
            return SendResult.SENT;
        } catch (Exception e) {
            log.error("Send mail failed: to={} subject={}", to, subject, e);
            return SendResult.FAILED;
        }
    }
}

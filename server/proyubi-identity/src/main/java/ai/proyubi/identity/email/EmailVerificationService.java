package ai.proyubi.identity.email;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.identity.mail.MailLocale;
import ai.proyubi.identity.mail.MailService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

/**
 * 邮箱验证码 — 生成、发送、校验。
 *
 * <p>限流策略：
 * <ul>
 *   <li>同邮箱 60 秒内只能发 1 次</li>
 *   <li>同邮箱 1 小时内最多 5 次</li>
 * </ul>
 *
 * <p>验证策略：
 * <ul>
 *   <li>验证码 6 位数字、SHA-256 hex 入库（不存明文）</li>
 *   <li>有效期 10 分钟</li>
 *   <li>每条码至多 5 次失败尝试，超出即失效</li>
 *   <li>校验成功立刻消费（一次性）</li>
 * </ul>
 *
 * <p>用途（purpose）：register / reset_password。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class EmailVerificationService {

    /** 注册和登录共用同一个 purpose（passwordless 流） */
    public static final String PURPOSE_LOGIN = "login";
    public static final String PURPOSE_RESET_PASSWORD = "reset_password";

    private static final int CODE_TTL_SECONDS = 600;
    private static final int RATE_WINDOW_SHORT = 60;
    private static final int RATE_LIMIT_SHORT = 1;
    private static final int RATE_WINDOW_LONG = 3600;
    private static final int RATE_LIMIT_LONG = 5;
    private static final int MAX_ATTEMPTS = 5;

    private final EmailVerificationMapper mapper;
    private final MailService mailService;
    private final SecureRandom random = new SecureRandom();

    /**
     * 生成验证码、入库、发送。失败时抛 BizException（前端统一展示）。
     */
    public void sendCode(String email, String purpose) {
        validatePurpose(purpose);
        String normalized = normalize(email);

        if (mapper.countRecent(normalized, purpose, RATE_WINDOW_SHORT) >= RATE_LIMIT_SHORT) {
            throw BizException.of(429, "请求过于频繁，请稍后再试");
        }
        if (mapper.countRecent(normalized, purpose, RATE_WINDOW_LONG) >= RATE_LIMIT_LONG) {
            throw BizException.of(429, "今日请求次数已达上限，请稍后再试");
        }

        String code = generate6DigitCode();
        String hash = sha256Hex(code);
        OffsetDateTime expiresAt = OffsetDateTime.now().plusSeconds(CODE_TTL_SECONDS);

        // 先发邮件，发送真实失败时不入库 —— 避免出现"用户看到已发送但收不到"的悬空记录，
        // 也不让外部服务抖动消耗用户的限流额度。
        // 验证码在登录/注册阶段发送，无租户上下文 → 只能用通用产品名 + 请求 locale 选语言。
        MailLocale.Lang lang = MailLocale.current();
        String appName = MailLocale.genericAppName(lang);
        String subject = buildSubject(lang, appName);
        String body = buildBody(code, purpose, lang, appName);
        MailService.SendResult result = mailService.sendText(normalized, subject, body);
        if (result == MailService.SendResult.FAILED) {
            throw BizException.of(503, "验证码发送失败，请稍后重试");
        }

        mapper.insert(UUID.randomUUID(), normalized, hash, purpose, expiresAt);
    }

    /**
     * 校验验证码：成功则消费（一次性）。失败抛 BizException。
     */
    public void verifyAndConsume(String email, String code, String purpose) {
        validatePurpose(purpose);
        String normalized = normalize(email);

        Map<String, Object> row = mapper.findLatestValid(normalized, purpose);
        if (row == null) {
            throw BizException.of(400, "验证码无效或已过期，请重新获取");
        }

        UUID id = (UUID) row.get("id");
        Integer attempts = (Integer) row.get("attempts");
        if (attempts != null && attempts >= MAX_ATTEMPTS) {
            throw BizException.of(400, "验证码尝试次数过多，请重新获取");
        }

        String storedHash = (String) row.get("codeHash");
        String inputHash = sha256Hex(code == null ? "" : code.trim());
        if (storedHash == null || !storedHash.equals(inputHash)) {
            mapper.incrementAttempts(id);
            throw BizException.of(400, "验证码错误");
        }

        mapper.markConsumed(id);
    }

    // --- helpers ---

    private static void validatePurpose(String purpose) {
        if (!PURPOSE_LOGIN.equals(purpose) && !PURPOSE_RESET_PASSWORD.equals(purpose)) {
            throw BizException.of(400, "不支持的验证码用途");
        }
    }

    private static String normalize(String email) {
        if (email == null || email.isBlank()) {
            throw BizException.of(400, "请输入邮箱");
        }
        return email.trim().toLowerCase();
    }

    private String generate6DigitCode() {
        return String.format("%06d", random.nextInt(1_000_000));
    }

    private static String sha256Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] bytes = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    private static String buildSubject(MailLocale.Lang lang, String appName) {
        return switch (lang) {
            case JA -> "認証コード - " + appName;
            case EN -> "Verification Code - " + appName;
            case ZH -> "验证码 - " + appName;
        };
    }

    private static String buildBody(String code, String purpose, MailLocale.Lang lang, String appName) {
        boolean isLogin = PURPOSE_LOGIN.equals(purpose);
        return switch (lang) {
            case JA -> {
                String use = isLogin ? "ログイン" : "パスワード再設定";
                yield """
                    %s の%sコードは以下です：

                        %s

                    このコードは 10 分間有効です。心当たりがない場合は本メールを破棄してください。
                    """.formatted(appName, use, code);
            }
            case EN -> {
                String use = isLogin ? "sign-in" : "password reset";
                yield """
                    Your %s %s code:

                        %s

                    This code expires in 10 minutes. If you didn't request it, please ignore this email.
                    """.formatted(appName, use, code);
            }
            case ZH -> {
                String use = isLogin ? "登录" : "密码重置";
                yield """
                    您的%s%s验证码如下：

                        %s

                    该验证码 10 分钟内有效。如非本人操作，请忽略此邮件。
                    """.formatted(appName, use, code);
            }
        };
    }
}

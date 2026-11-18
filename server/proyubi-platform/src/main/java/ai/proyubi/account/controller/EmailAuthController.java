package ai.proyubi.account.controller;

import cn.dev33.satoken.stp.SaLoginModel;
import ai.proyubi.common.core.web.R;
import ai.proyubi.common.satoken.stp.StpTenant;
import ai.proyubi.identity.authprovider.AuthResult;
import ai.proyubi.identity.email.EmailAuthService;
import ai.proyubi.identity.email.EmailVerificationService;
import ai.proyubi.regions.region.Region;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 邮箱 Passwordless 注册/登录 Controller。
 *
 * <p>两个端点：
 * <ul>
 *   <li>{@code POST /app/auth/email/request-code} — 发送 OTP（不区分账号是否存在，防邮箱枚举）</li>
 *   <li>{@code POST /app/auth/email/verify} — 校验 OTP；命中则登录，没账号就自动创建</li>
 * </ul>
 *
 * <p>路径已在 SaTokenWebMvcConfig 排除登录拦截。
 */
@Slf4j
@RestController
@RequestMapping("/app/auth/email")
@Validated
@RequiredArgsConstructor
public class EmailAuthController {

    private final EmailVerificationService verificationService;
    private final EmailAuthService emailAuthService;

    @Value("${app.region:JP}")
    private String regionStr;

    /**
     * 发送邮箱验证码（注册/登录共用）。无论账号是否存在都返回成功。
     */
    @PostMapping("/request-code")
    public R<Void> requestCode(@RequestBody @Validated RequestCodeReq req) {
        verificationService.sendCode(req.email, EmailVerificationService.PURPOSE_LOGIN);
        return R.ok();
    }

    /**
     * 校验验证码并登录。账号不存在时自动创建。
     */
    @PostMapping("/verify")
    public R<VerifyResp> verify(@RequestBody @Validated VerifyReq req) {
        AuthResult result = emailAuthService.verifyAndAuthenticate(
            req.email, req.code, parseRegion(regionStr));

        StpTenant.STP_LOGIC.login(result.loginId(), new SaLoginModel());
        StpTenant.STP_LOGIC.getSession().set("tenant_id", result.tenantId().toString());
        StpTenant.STP_LOGIC.getSession().set("user_id", result.tenantUserId().toString());
        // 账号级标识：用于 /me 列出可切换团队、switch-team 校验同账号
        if (result.email() != null) {
            StpTenant.STP_LOGIC.getSession().set("account_email", result.email().toLowerCase());
        }
        return R.ok(new VerifyResp(StpTenant.STP_LOGIC.getTokenValue(), result.loginId()));
    }

    // --- helpers ---

    private static Region parseRegion(String s) {
        if (s == null || s.isBlank()) return Region.GLOBAL;
        try {
            return Region.valueOf(s.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return Region.GLOBAL;
        }
    }

    // --- DTOs ---

    public record RequestCodeReq(@NotBlank @Email String email) {}

    public record VerifyReq(
        @NotBlank @Email String email,
        @NotBlank @Size(min = 6, max = 6) String code
    ) {}

    public record VerifyResp(String token, String loginId) {}
}

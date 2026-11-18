package ai.proyubi.account.controller;

import ai.proyubi.common.core.web.R;
import ai.proyubi.account.service.AppMyInvitationService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 邀请 — 公开接口（邮件深链预览，无需登录）。
 *
 * <p>路径前缀 {@code /app/public/**} 已在 {@code SaTokenWebMvcConfig} 白名单中，不走 Sa-Token 鉴权。
 * 接受动作仍需登录（见 {@link AppMyInvitationController#acceptByToken}）。
 */
@RestController
@RequestMapping("/app/public/invitations")
@RequiredArgsConstructor
public class AppPublicInvitationController {

    private final AppMyInvitationService myInvitationService;

    /**
     * 凭 token 预览邀请信息（租户名 / 邀请人 / 被邀请邮箱 / 状态）。
     */
    @GetMapping("/by-token")
    public R<AppMyInvitationService.InvitationPreview> byToken(@RequestParam("token") String token) {
        return R.ok(myInvitationService.previewByToken(token));
    }
}

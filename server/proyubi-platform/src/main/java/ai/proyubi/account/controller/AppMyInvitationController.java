package ai.proyubi.account.controller;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.common.satoken.stp.StpTenant;
import ai.proyubi.account.domain.InvitationVO;
import ai.proyubi.account.service.AppMyInvitationService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 邀请 — 被邀请人侧。
 *
 * <p>路径 /app/invitations 与 owner 侧 /app/team/invitations 区分；前者按当前登录账号操作，
 * 不要求 owner 角色。
 */
@RestController
@RequestMapping("/app/invitations")
@RequiredArgsConstructor
public class AppMyInvitationController {

    private final AppMyInvitationService myInvitationService;

    /**
     * 当前账号的待处理邀请。
     */
    @GetMapping("/inbox")
    public R<List<InvitationVO>> inbox() {
        return R.ok(myInvitationService.listInbox(getAccountEmail()));
    }

    /**
     * 接受邀请。
     */
    @PostMapping("/{id}/accept")
    public R<AcceptResp> accept(@PathVariable UUID id) {
        AppMyInvitationService.AcceptResult result =
                myInvitationService.accept(getAccountEmail(), id);
        return R.ok(new AcceptResp(
                result.tenantUserId().toString(),
                result.tenantId().toString(),
                result.tenantName()));
    }

    /**
     * 拒绝邀请。
     */
    @PostMapping("/{id}/decline")
    public R<Void> decline(@PathVariable UUID id) {
        myInvitationService.decline(getAccountEmail(), id);
        return R.ok(null);
    }

    /**
     * 凭邮件 token 接受邀请（需登录；当前账号邮箱须与被邀请邮箱一致）。
     */
    @PostMapping("/accept-by-token")
    public R<AcceptResp> acceptByToken(@RequestBody TokenReq req) {
        AppMyInvitationService.AcceptResult result =
                myInvitationService.acceptByToken(getAccountEmail(), req.token());
        return R.ok(new AcceptResp(
                result.tenantUserId().toString(),
                result.tenantId().toString(),
                result.tenantName()));
    }

    public record TokenReq(String token) {}

    // --- helpers ---

    private String getAccountEmail() {
        Object email = StpTenant.STP_LOGIC.getSession().get("account_email");
        if (email == null || email.toString().isBlank()) {
            throw BizException.of(403, "当前登录方式不支持处理邀请");
        }
        return email.toString();
    }

    public record AcceptResp(String tenantUserId, String tenantId, String tenantName) {}
}

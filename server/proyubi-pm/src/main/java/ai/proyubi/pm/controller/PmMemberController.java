package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.service.PmMemberService;
import ai.proyubi.pm.vo.PmTenantUserVO;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 团队成员Controller（PM）
 *
 */
@RestController
@RequestMapping("/app/pm/members")
@Validated
public class PmMemberController {

    private final PmMemberService memberService;

    public PmMemberController(PmMemberService memberService) {
        this.memberService = memberService;
    }

    @GetMapping
    public R<List<PmMember>> list() {
        return R.ok(memberService.list(getTenantId()));
    }

    /** 当前租户中尚未加入 PM 的用户（供"拉人进来"选择） */
    @GetMapping("/available")
    public R<List<PmTenantUserVO>> available() {
        return R.ok(memberService.listAvailableTenantUsers(getTenantId()));
    }

    @PostMapping
    public R<PmMember> create(@RequestBody @Valid MemberReq req) {
        return R.ok(memberService.create(getTenantId(), req.userId(), req.name(), req.color(), req.role()));
    }

    @PutMapping("/{id}")
    public R<PmMember> update(@PathVariable UUID id, @RequestBody @Valid UpdateMemberReq req) {
        return R.ok(memberService.update(id, getTenantId(), req.name(), req.color(), req.role()));
    }

    @DeleteMapping("/{id}")
    public R<Void> delete(@PathVariable UUID id) {
        memberService.delete(id, getTenantId());
        return R.ok();
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    /** 新增成员：从租户用户绑定；name 可空（默认取 display_name） */
    public record MemberReq(
        @NotNull UUID userId,
        String name,
        String color,
        String role
    ) {
    }

    /** 编辑成员：仅改甘特显示名 / 颜色 / 角色 */
    public record UpdateMemberReq(
        String name,
        String color,
        String role
    ) {
    }
}

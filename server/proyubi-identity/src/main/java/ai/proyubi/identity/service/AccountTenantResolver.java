package ai.proyubi.identity.service;

import ai.proyubi.identity.mapper.IdentityMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 「邮箱账号 → 落到哪个 tenant_user」的<b>唯一</b>解析入口。
 *
 * <p>一个邮箱在系统里可以对应多条 email identity：自己注册时创建的那条，加上每接受一次团队邀请
 * 新增的那条（见 {@code AppInvitationMapper.insertEmailMembershipIdentity}）。因此「用这个邮箱登录，
 * 登进哪个团队」需要一套规则，而这套规则<b>必须被所有登录路径共用</b>——
 * 邮箱验证码登录、邮箱+密码登录如果各算各的，同一个账号在两条路径下会登进不同团队
 * （历史 bug：验证码登录走偏好、密码登录走 created_at 最早，用户表现为「登录后变成了另一个账号」）。
 *
 * <p>规则：上次切换的团队（{@code platform_account_preference}）→ 失效则回退默认团队
 * （最早创建的 tenant_user）。
 */
@Service
@RequiredArgsConstructor
public class AccountTenantResolver {

    private final IdentityMapper identityMapper;

    /**
     * 解析该邮箱本次登录应落到的 tenant_user。
     *
     * @return 与 {@link IdentityMapper#findEmailIdentityForLogin(String)} 同形状的行；
     *         该邮箱在系统中不存在时返回 null
     */
    public Map<String, Object> resolve(String email) {
        if (email == null || email.isBlank()) {
            return null;
        }
        Map<String, Object> preferred = identityMapper.findPreferredTenantUserForLogin(email);
        return preferred != null ? preferred : identityMapper.findEmailIdentityForLogin(email);
    }
}

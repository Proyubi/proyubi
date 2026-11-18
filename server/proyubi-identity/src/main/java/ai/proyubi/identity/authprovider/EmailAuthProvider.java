package ai.proyubi.identity.authprovider;

import org.springframework.stereotype.Component;

/**
 * 邮箱+密码认证提供者
 *
 * <p>v0.5 暂未实现密码登录（JP 主打 Google 登录，密码入口后续版本再考虑）。
 *
 */
@Component
public class EmailAuthProvider implements AuthProvider {

    @Override
    public String getType() {
        return "email";
    }

    @Override
    public AuthResult authenticate(String identifier, String credential) {
        // TODO: v0.6 实现邮箱+密码登录
        return AuthResult.failure("not_implemented");
    }
}

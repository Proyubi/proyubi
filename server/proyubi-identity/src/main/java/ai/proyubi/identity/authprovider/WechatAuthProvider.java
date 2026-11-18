package ai.proyubi.identity.authprovider;

import org.springframework.stereotype.Component;

/**
 * 微信认证提供者
 *
 * <p>v0.5 暂未实现（JP 不启用，CN 在后续版本做）。
 *
 */
@Component
public class WechatAuthProvider implements AuthProvider {

    @Override
    public String getType() {
        return "wechat";
    }

    @Override
    public boolean isOAuth() {
        return true;
    }

    @Override
    public boolean isConfigured() {
        return false;
    }
}

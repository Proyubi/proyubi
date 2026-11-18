package ai.proyubi.identity.accountmodel;

import org.springframework.stereotype.Component;

/**
 * 工作空间账号模型
 * 每个租户可以有多个用户账号，支持协作
 *
 * <p>V1 不启用，V2 多成员时再实现。现仅保留 Bean 注册。
 *
 */
@Component
public class WorkspaceAccountModel implements AccountModel {

    @Override
    public String getType() {
        return "workspace";
    }
}

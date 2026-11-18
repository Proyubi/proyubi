package ai.proyubi.identity.accountmodel;

import ai.proyubi.identity.authprovider.OAuthUserProfile;
import ai.proyubi.regions.region.Region;

/**
 * 账号模型接口
 * 不同地区可以有不同的账号模型（单用户、工作空间等）
 *
 * <p>职责：根据账号模型决定"怎么建一个新租户 + 新用户 + 初始身份"。
 * 不做 find-or-create 编排，find 由 IdentityService 负责。
 *
 */
public interface AccountModel {

    /**
     * 获取账号模型类型
     *
     * @return 账号模型类型（single-user、workspace等）
     */
    String getType();

    /**
     * 是否支持该账号模型
     */
    default boolean supports(String type) {
        return getType().equals(type);
    }

    /**
     * 通过 OAuth 画像创建新账号（新租户 + 新用户 + oauth identity + email identity）。
     *
     * @param profile OAuth 提供方返回的画像
     * @param region  账号所属区域（用于 tenant.region 字段）
     * @return 新建的账号信息
     */
    default CreatedAccount createOAuthAccount(OAuthUserProfile profile, Region region) {
        throw new UnsupportedOperationException(
            getType() + " account model does not support OAuth-based account creation");
    }

}

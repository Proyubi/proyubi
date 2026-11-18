package ai.proyubi.identity.authprovider;

/**
 * OAuth 提供方返回的用户画像（归一化后）
 *
 * <p>不同 OAuth 提供方（Google / Apple / LINE / Wechat）字段名不一致，统一抽象成这个 record。
 * AuthProvider.exchangeOAuth(code) 的返回值。
 *
 * @param providerType  提供方类型（google/line/wechat 等，和 AuthProvider#getType 对应）
 * @param externalId    提供方侧的永久用户 ID（Google 的 sub / LINE 的 userId / Wechat 的 unionid）
 * @param email         邮箱（可能为空，如 LINE 不一定给）
 * @param emailVerified 邮箱是否已验证
 * @param name          用户的展示名
 * @param picture       头像 URL
 */
public record OAuthUserProfile(
    String providerType,
    String externalId,
    String email,
    boolean emailVerified,
    String name,
    String picture
) {

    /**
     * 构造成 identity 表的 identifier 值（"google:{sub}"、"line:{userId}" 等）
     */
    public String toIdentityIdentifier() {
        return providerType + ":" + externalId;
    }
}

package ai.proyubi.account.domain;

import java.util.Map;
import java.util.UUID;

/**
 * 团队（platform_team）VO —— 租户内的子团队。
 *
 * @param canCreateMore 当前套餐是否允许继续新建团队（PRO/TRIAL=true，FREE=false）
 */
public record TeamVO(
        UUID id,
        String name,
        String color,
        boolean isDefault,
        int sortOrder,
        long memberCount,
        boolean canCreateMore
) {
    public static TeamVO from(Map<String, Object> r, boolean canCreateMore) {
        if (r == null) return null;
        return new TeamVO(
                (UUID) r.get("id"),
                (String) r.get("name"),
                (String) r.get("color"),
                Boolean.TRUE.equals(r.get("isDefault")),
                r.get("sortOrder") == null ? 0 : ((Number) r.get("sortOrder")).intValue(),
                r.get("memberCount") == null ? 0L : ((Number) r.get("memberCount")).longValue(),
                canCreateMore
        );
    }
}

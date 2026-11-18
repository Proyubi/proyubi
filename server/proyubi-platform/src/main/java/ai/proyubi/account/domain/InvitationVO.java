package ai.proyubi.account.domain;

import lombok.Data;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 团队邀请 VO
 */
@Data
public class InvitationVO {
    private UUID id;
    private UUID tenantId;
    private UUID inviterUserId;
    private String inviterName;
    private String tenantName;
    private String email;
    private String displayName;
    private String role;
    private List<String> customPermissions;
    private String message;
    private String status;
    private OffsetDateTime expiresAt;
    private OffsetDateTime acceptedAt;
    private OffsetDateTime createdAt;
    /** 被邀请邮箱在系统中是否已注册（owner 侧 check 接口用）。 */
    private Boolean accountExists;
    /** 是否已是本租户成员（owner 侧 check 接口用）。 */
    private Boolean alreadyMember;
    /** 邀请目标团队 id 列表（null/空=默认团队）。 */
    private List<String> teamIds;
}

package ai.proyubi.account.domain;

import lombok.Data;

import java.util.List;
import java.util.UUID;

/**
 * 成员权限 VO
 */
@Data
public class MemberPermissionsVO {
    private UUID memberId;
    private boolean isCustom;        // true=自定义权限，false=默认权限
    private List<String> permissions; // 权限代码列表
}

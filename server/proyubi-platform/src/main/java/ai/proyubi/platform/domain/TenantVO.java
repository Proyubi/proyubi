package ai.proyubi.platform.domain;

import lombok.Data;

/**
 * 租户列表 VO
 */
@Data
public class TenantVO {
    private String id;
    private String code;
    private String name;
    private String region;
    private String status;
    private String planType;
    private String subscriptionStatus;
    private Integer memberCount;
    private String createdAt;
    private String updatedAt;
}

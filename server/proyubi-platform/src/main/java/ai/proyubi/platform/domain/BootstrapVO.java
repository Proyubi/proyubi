package ai.proyubi.platform.domain;

import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * Bootstrap 响应 VO
 *
 */
@Data
public class BootstrapVO {

    /**
     * 启用的能力列表（含状态和限额）
     */
    private List<CapabilityInfo> enabledCapabilities;

    /**
     * 授予的权限列表（RBAC ∩ Capability）
     */
    private List<String> grantedPermissions;

    /**
     * 菜单树（已过滤）
     */
    private List<RouteItemVO> menuTree;

    /**
     * 能力信息
     */
    @Data
    public static class CapabilityInfo {
        private String code;
        private String name;
        private String status; // enabled/enabled_with_limit/disabled
        private Map<String, Object> limits; // 限额配置（JSON）
    }
}


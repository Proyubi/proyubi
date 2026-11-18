package ai.proyubi.regions.region;

import ai.proyubi.capabilities.capability.Capability;
import ai.proyubi.capabilities.capability.CapabilityStatus;
import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * 区域配置
 * 定义每个区域启用的认证提供者、能力和默认账号模型
 *
 */
@Data
public class RegionProfile {

    /**
     * 区域
     */
    private Region region;

    /**
     * 启用的认证提供者列表
     */
    private List<String> enabledAuthProviders;

    /**
     * 能力配置（能力 -> 状态）
     */
    private Map<Capability, CapabilityStatus> enabledCapabilities;

    /**
     * 默认账号模型
     */
    private String defaultAccountModel;
}


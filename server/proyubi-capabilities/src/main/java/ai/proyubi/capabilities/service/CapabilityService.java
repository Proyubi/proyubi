package ai.proyubi.capabilities.service;

import ai.proyubi.capabilities.capability.Capability;
import ai.proyubi.capabilities.capability.CapabilityStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;

/**
 * 能力服务
 * 根据 Region Profile 和订阅等级判断能力状态
 *
 */
@Service
@RequiredArgsConstructor
public class CapabilityService {

    // TODO: 注入 RegionProfileService 以获取区域配置
    // TODO: 注入 SubscriptionService 以获取订阅等级

    /**
     * 检查能力是否可用
     *
     * @param tenantId 租户ID
     * @param capability 能力
     * @return 能力状态
     */
    public CapabilityStatus checkCapability(UUID tenantId, Capability capability) {
        // TODO: 实现能力检查逻辑
        // 1. 获取租户的区域配置
        // 2. 从 Region Profile 获取能力状态
        // 3. 如果状态为 ENABLED_WITH_LIMIT，检查订阅等级
        // 4. 返回最终状态

        // 临时实现：返回 ENABLED
        return CapabilityStatus.ENABLED;
    }

    /**
     * 检查能力是否启用（包括 ENABLED 和 ENABLED_WITH_LIMIT）
     *
     * @param tenantId 租户ID
     * @param capability 能力
     * @return 是否启用
     */
    public boolean isCapabilityEnabled(UUID tenantId, Capability capability) {
        CapabilityStatus status = checkCapability(tenantId, capability);
        return status == CapabilityStatus.ENABLED || status == CapabilityStatus.ENABLED_WITH_LIMIT;
    }

    /**
     * 获取所有能力的状态
     *
     * @param tenantId 租户ID
     * @return 能力状态映射
     */
    public Map<Capability, CapabilityStatus> getAllCapabilities(UUID tenantId) {
        // TODO: 实现获取所有能力状态的逻辑
        // 临时实现：返回空映射
        return Map.of();
    }
}


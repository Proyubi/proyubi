package ai.proyubi.regions.service;

import ai.proyubi.regions.region.Region;
import ai.proyubi.regions.region.RegionConfigLoader;
import ai.proyubi.regions.region.RegionProfile;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * 区域配置服务
 * 根据租户的区域获取对应的配置
 *
 */
@Service
@RequiredArgsConstructor
public class RegionProfileService {

    private final RegionConfigLoader configLoader;

    // TODO: 注入 TenantMapper 以获取租户的区域信息

    /**
     * 获取租户的区域配置
     *
     * @param tenantId 租户ID
     * @return 区域配置
     */
    public RegionProfile getProfileByTenant(UUID tenantId) {
        // TODO: 从数据库获取租户的区域信息
        // 临时实现：返回 GLOBAL 配置
        return configLoader.getProfile(Region.GLOBAL);
    }

    /**
     * 获取指定区域的配置
     *
     * @param region 区域
     * @return 区域配置
     */
    public RegionProfile getProfile(Region region) {
        return configLoader.getProfile(region);
    }
}


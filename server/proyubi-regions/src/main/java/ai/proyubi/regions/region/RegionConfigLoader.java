package ai.proyubi.regions.region;

import ai.proyubi.capabilities.capability.Capability;
import ai.proyubi.capabilities.capability.CapabilityStatus;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.yaml.snakeyaml.Yaml;

import jakarta.annotation.PostConstruct;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 区域配置加载器
 * 启动时加载所有区域配置文件
 *
 */
@Slf4j
@Component
public class RegionConfigLoader {

    private final Map<Region, RegionProfile> profiles = new HashMap<>();

    @PostConstruct
    public void loadProfiles() {
        log.info("开始加载区域配置...");

        // 加载所有区域配置
        for (Region region : Region.values()) {
            String configFile = "regions/" + region.name().toLowerCase() + ".yaml";
            try {
                ClassPathResource resource = new ClassPathResource(configFile);
                if (resource.exists()) {
                    try (InputStream inputStream = resource.getInputStream()) {
                        Yaml yaml = new Yaml();
                        Map<String, Object> data = yaml.load(inputStream);
                        RegionProfile profile = parseProfile(region, data);
                        profiles.put(region, profile);
                        log.info("加载区域配置成功: {}", region);
                    }
                } else {
                    log.warn("区域配置文件不存在: {}", configFile);
                }
            } catch (Exception e) {
                log.error("加载区域配置失败: {}", configFile, e);
            }
        }

        log.info("区域配置加载完成，共 {} 个区域", profiles.size());
    }

    /**
     * 解析配置文件为 RegionProfile
     */
    private RegionProfile parseProfile(Region region, Map<String, Object> data) {
        RegionProfile profile = new RegionProfile();
        profile.setRegion(region);

        // 解析认证提供者
        if (data.containsKey("auth") && data.get("auth") instanceof Map) {
            Map<String, Object> auth = (Map<String, Object>) data.get("auth");
            List<String> providers = auth.entrySet().stream()
                .filter(entry -> {
                    Object value = entry.getValue();
                    return value instanceof String && "enabled".equals(value);
                })
                .map(Map.Entry::getKey)
                .toList();
            profile.setEnabledAuthProviders(providers);
        }

        // 解析能力配置
        if (data.containsKey("capabilities") && data.get("capabilities") instanceof Map) {
            Map<String, Object> capabilities = (Map<String, Object>) data.get("capabilities");
            Map<Capability, CapabilityStatus> capabilityMap = new HashMap<>();
            for (Map.Entry<String, Object> entry : capabilities.entrySet()) {
                try {
                    Capability capability = Capability.valueOf(entry.getKey().toUpperCase());
                    String statusStr = entry.getValue().toString();
                    CapabilityStatus status = CapabilityStatus.valueOf(statusStr.toUpperCase());
                    capabilityMap.put(capability, status);
                } catch (IllegalArgumentException e) {
                    log.warn("无法解析能力配置: {} = {}", entry.getKey(), entry.getValue());
                }
            }
            profile.setEnabledCapabilities(capabilityMap);
        }

        // 解析默认账号模型
        if (data.containsKey("account_model") && data.get("account_model") instanceof Map) {
            Map<String, Object> accountModel = (Map<String, Object>) data.get("account_model");
            if (accountModel.containsKey("default")) {
                profile.setDefaultAccountModel(accountModel.get("default").toString());
            }
        }

        return profile;
    }

    /**
     * 获取区域配置
     */
    public RegionProfile getProfile(Region region) {
        return profiles.get(region);
    }

    /**
     * 获取所有区域配置
     */
    public Map<Region, RegionProfile> getAllProfiles() {
        return new HashMap<>(profiles);
    }
}


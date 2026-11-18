package ai.proyubi.capabilities.capability;

/**
 * 能力状态
 * 定义能力的三种状态
 *
 */
public enum CapabilityStatus {
    /**
     * 禁用
     */
    DISABLED,

    /**
     * 启用
     */
    ENABLED,

    /**
     * 启用但有限制（如 Pro 功能）
     */
    ENABLED_WITH_LIMIT
}


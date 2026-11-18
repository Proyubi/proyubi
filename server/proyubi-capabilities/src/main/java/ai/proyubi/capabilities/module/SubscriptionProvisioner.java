package ai.proyubi.capabilities.module;

import org.springframework.stereotype.Service;

import java.util.function.Consumer;

/**
 * 给新建租户发齐全部可售模块(wms/pm/bk)的 FREE 订阅（freee 模型 A · per-module 计费）。
 *
 * <p>模型 A：订阅/计费按模块各自独立 → 新租户需对每个可售模块各发一份订阅。注册即建 FREE 行，
 * 使「每 租户×可售模块 一行」的数据模型对新租户也成立（与 {@link ModuleGrantProvisioner}
 * 发 owner grant 并排）。语义中性：消费方对无订阅行本就回退 FREE，显式 FREE 行与之等价。
 *
 * <p><b>持久化解耦</b>：与 {@link ModuleGrantProvisioner} 同样的做法——capabilities-core 无
 * mybatis 依赖、不在 {@code @MapperScan} 内，故本类不直接依赖任何 mapper。由调用方传入一个
 * {@code (module-code) -> 幂等插入 FREE 订阅} 的回调，本类只负责「枚举可售模块」这份逻辑。
 */
@Service
public class SubscriptionProvisioner {

    /**
     * 对全部可售模块(wms/pm/bk)逐个调用 subscriptionSink，由后者幂等插入 FREE 订阅。
     *
     * @param subscriptionSink (module-code) -> 幂等插入该模块 FREE 订阅的动作（调用方注入 mapper 实现）
     */
    public void ensureFreeSubscriptions(Consumer<String> subscriptionSink) {
        for (Module m : Module.values()) {
            if (m.isSellable()) {
                subscriptionSink.accept(m.code());   // wms / pm / bk
            }
        }
    }
}

package ai.proyubi.capabilities.module;

import org.springframework.stereotype.Service;

import java.util.function.Consumer;

/**
 * 给新建 owner 发齐全部可售模块(wms/pm/bk)的 owner grant（freee 模型 A）。
 *
 * <p>模型 A：账号(認証認可)与租户(事業所)共享，但准入按模块各自独立 → 新 owner 需对
 * 每个可售模块各发一条 owner grant，事業所主才能在任意模块入口畅通。
 *
 * <p><b>口径差异（刻意，请勿"对齐"）</b>：回填迁移
 * {@code 2026-06-16-platform-module-grant.sql} 给「全部活跃用户」发全模块 grant，
 * 以兼容当前「人人可达各模块」的存量现状；而本 provisioner 只给 <b>owner</b> 发——
 * 新成员(member)的 grant 由邀请 accept 各自决定（见 AppMyInvitationService.accept）。
 *
 * <p><b>持久化解耦</b>：capabilities-core 无 mybatis 依赖、不在 {@code @MapperScan} 内，
 * 故本类不直接依赖任何 mapper。由调用方传入一个 {@code (module-code) -> 幂等插入 owner grant}
 * 的回调，本类只负责「枚举可售模块」这一份逻辑，逐个回调。这样既把枚举逻辑集中一处，
 * 又用调用方各自已扫描的 mapper 完成插入，避免给 capabilities-core 加 mybatis 依赖、
 * 也避免扩 {@code @MapperScan}。
 */
@Service
public class ModuleGrantProvisioner {

    /**
     * 对全部可售模块(wms/pm/bk)逐个调用 grantSink，由后者幂等插入 owner grant。
     *
     * @param grantSink (module-code) -> 幂等插入该模块 owner grant 的动作（调用方注入 mapper 实现）
     */
    public void ensureOwnerGrants(Consumer<String> grantSink) {
        for (Module m : Module.values()) {
            if (m.isSellable()) {
                grantSink.accept(m.code());   // wms / pm / bk
            }
        }
    }
}

package ai.proyubi.platform.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mybatisflex.core.query.QueryWrapper;
import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.satoken.stp.StpPlatform;
import ai.proyubi.platform.domain.*;
import ai.proyubi.platform.mapper.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.*;
import java.util.stream.Collectors;

import static ai.proyubi.platform.domain.table.PermissionDefTableDef.PERMISSION_DEF;

/**
 * Bootstrap 服务
 * 提供应用启动时需要的所有配置数据：能力、权限、菜单
 *
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BootstrapService {

    /** 可售模块（各自一份订阅/套餐）；与 ai.proyubi.capabilities.module.Module#isSellable 对齐。 */
    private static final List<String> SELLABLE_MODULES = List.of("wms", "pm", "bk");

    private final AppClientService appClientService;
    private final PlanService planService;
    private final MenuService menuService;
    private final PlanCapabilityMapper planCapabilityMapper;
    private final CapabilityPermissionMapper capabilityPermissionMapper;
    private final PermissionDefMapper permissionDefMapper;
    private final SubscriptionMapper subscriptionMapper;
    private final TenantUserMapper tenantUserMapper;
    private final Environment environment;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 获取 Bootstrap 数据
     *
     * @param appCode App 代码（如 ops-web, admin-web）
     * @return Bootstrap 数据
     */
    public BootstrapVO getBootstrap(String appCode) {
        log.info("获取 Bootstrap 数据: appCode={}", appCode);

        // 检查当前用户是否是超级管理员
        boolean isAdmin = isSuperAdmin();
        log.info("当前用户是否为超级管理员: {}", isAdmin);

        // 1. 获取 App 信息
        AppClient app = appClientService.getByAppCode(appCode);
        if (app == null || !"active".equals(app.getStatus())) {
            throw new RuntimeException("App 不存在或已停用: " + appCode);
        }

        // 2~3. 获取当前租户「各可售模块」的订阅档位，并 union 各模块套餐对应的能力列表。
        //   per-module（freee 模型 A）：订阅/套餐按模块独立，套餐码为 <module>-<tier>（如 wms-pro）。
        //   逐模块解析档位（无订阅回退 FREE；运营端无租户时全模块按 PRO），union 后与拆分前
        //   「同一租户各模块同档」的能力全集一致。
        UUID tenantId = TenantContext.getTenantId();
        List<Map<String, Object>> capabilityList = new ArrayList<>();
        for (String moduleCode : SELLABLE_MODULES) {
            String planType;
            if (tenantId != null) {
                SubscriptionVO subscription =
                    subscriptionMapper.selectActiveSubscriptionByTenantId(tenantId, moduleCode);
                planType = subscription != null ? subscription.getPlanType() : "FREE";
            } else {
                // 运营端默认使用 PRO 套餐（所有功能）
                planType = "PRO";
            }
            String planCode = moduleCode + "-" + planType.toLowerCase();
            log.debug("模块 {} planCode: {}", moduleCode, planCode);
            capabilityList.addAll(planCapabilityMapper.selectCapabilitiesByPlanCode(planCode));
        }
        List<BootstrapVO.CapabilityInfo> enabledCapabilities = new ArrayList<>();
        List<UUID> enabledCapabilityIds = new ArrayList<>();

        for (Map<String, Object> cap : capabilityList) {
            String status = (String) cap.get("status");
            if ("enabled".equals(status) || "enabled_with_limit".equals(status)) {
                BootstrapVO.CapabilityInfo info = new BootstrapVO.CapabilityInfo();
                info.setCode((String) cap.get("code"));
                info.setName((String) cap.get("name"));
                info.setStatus(status);

                // 解析 limit_json
                Object limitJson = cap.get("limitJson");
                if (limitJson != null) {
                    try {
                        Map<String, Object> limits = objectMapper.convertValue(limitJson, new TypeReference<Map<String, Object>>() {});
                        info.setLimits(limits);
                    } catch (Exception e) {
                        log.warn("解析 limit_json 失败: {}", e.getMessage());
                    }
                }

                enabledCapabilities.add(info);
                enabledCapabilityIds.add((UUID) cap.get("id"));
            }
        }

        log.debug("启用的能力数量: {}", enabledCapabilities.size());

        // 4. 获取能力关联的权限代码列表
        Set<String> capabilityPermissions = new HashSet<>();
        if (!enabledCapabilityIds.isEmpty()) {
            List<String> permCodes = capabilityPermissionMapper.selectPermissionCodesByCapabilityIds(enabledCapabilityIds);
            capabilityPermissions.addAll(permCodes);
        }

        log.debug("能力关联的权限数量: {}", capabilityPermissions.size());

        // 5. 获取用户的 RBAC 权限
        Set<String> grantedPermissions;
        if (isAdmin) {
            // 超级管理员：获取所有权限
            log.info("超级管理员，返回所有权限");
            List<PermissionDef> allPermissions = permissionDefMapper.selectListByQuery(
                QueryWrapper.create()
                    .from(PERMISSION_DEF)
                    .where(PERMISSION_DEF.DELETED_AT.isNull())
            );
            grantedPermissions = allPermissions.stream()
                .map(PermissionDef::getCode)
                .collect(Collectors.toSet());
            log.info("超级管理员权限数量: {}", grantedPermissions.size());
        } else {
            // 套餐能力权限为基础
            grantedPermissions = new HashSet<>(capabilityPermissions);

            // 多成员模式：如果当前用户是 member 角色，与 member 允许的权限取交集
            UUID userId = TenantContext.getUserId();
            if (userId != null && tenantId != null) {
                String role = tenantUserMapper.findRoleByTenantUserId(userId);
                if ("member".equals(role)) {
                    Set<String> memberPermissions = resolveMemberPermissions(userId);
                    grantedPermissions.retainAll(memberPermissions);
                    log.debug("member 角色权限过滤后: {}", grantedPermissions.size());
                }
            }
            log.debug("最终授予的权限数量: {}", grantedPermissions.size());
        }

        // 7. 获取菜单树（按 app_id 和权限过滤）
        // 如果是超级管理员，传入 null 表示不进行权限过滤
        log.info("查询菜单: appId={}, audience={}, isAdmin={}", app.getId(), app.getAudience(), isAdmin);
        List<RouteItemVO> menuTree = menuService.listMenusAsRouteItemsForApp(
            app.getId(),
            app.getAudience(),
            isAdmin ? null : new ArrayList<>(grantedPermissions)
        );

        if (menuTree.isEmpty()) {
            log.warn("菜单查询结果为空！请检查 platform_sys_menu 中是否有 app_id={} 或 app_id IS NULL 且 audience='{}' 的数据",
                app.getId(), app.getAudience());
        } else {
            log.info("菜单树节点数量: {}", menuTree.size());
        }

        // 8. 构建响应
        BootstrapVO bootstrap = new BootstrapVO();
        bootstrap.setEnabledCapabilities(enabledCapabilities);
        bootstrap.setGrantedPermissions(new ArrayList<>(grantedPermissions));
        bootstrap.setMenuTree(menuTree);

        log.info("Bootstrap 数据获取完成: capabilities={}, permissions={}, menus={}",
            enabledCapabilities.size(), grantedPermissions.size(), menuTree.size());

        return bootstrap;
    }

    /**
     * 解析 member 用户的权限集合。
     * ③-b（模型 A）：权限按模块存于 platform_module_grant。这里读 wms grant 的 permissions
     * （Owner 为其配置的自定义权限），未配置则回退到默认 member 权限集合。
     * 注：目前仅 WMS 应用启用成员权限过滤，故固定取 module='wms'；待 pm/bk 各自成员管理就绪后，
     * 再按 appCode→module 泛化。
     */
    private Set<String> resolveMemberPermissions(UUID userId) {
        String customPermsJson = tenantUserMapper.findGrantPermissions(userId, "wms");
        if (customPermsJson != null && !customPermsJson.isBlank()) {
            try {
                List<String> customList = objectMapper.readValue(customPermsJson,
                        new TypeReference<List<String>>() {});
                log.debug("使用自定义权限，数量: {}", customList.size());
                return new HashSet<>(customList);
            } catch (IOException e) {
                log.warn("解析 custom_permissions 失败，回退到默认权限: {}", e.getMessage());
            }
        }
        return getMemberRolePermissions();
    }

    /**
     * member 角色允许的权限列表（硬编码，基于 PRD 权限矩阵）
     * Owner 拥有所有套餐能力权限，Member 只拥有以下子集。
     */
    static Set<String> getMemberRolePermissions() {
        return Set.of(
                // 产品（查看、入库出库相关）
                "app:product:list",
                "app:product:add",
                "app:product:edit",
                // 库存
                "app:stock:list",
                // 出入库
                "app:transaction:list",
                "app:transaction:add",
                // 盘点（delete = 撤销单个商品的盘点项，属于逐个商品盘点的主流程；
                //       void = 作废整单，破坏性操作，与 app:transaction:void 一致不给 member）
                "app:inventory-check:list",
                "app:inventory-check:add",
                "app:inventory-check:edit",
                "app:inventory-check:delete",
                // 联系人
                "app:contact:list",
                "app:contact:add",
                "app:contact:edit",
                // 记账（查看和新增）
                "app:expense:list",
                "app:expense:add",
                // 信封预算（查看、新增、记录）
                "app:envelope:list",
                "app:envelope:add",
                "app:envelope:edit",
                "app:envelope:transaction:add",
                "app:envelope:transaction:void",
                // 团队（只读查看）
                "app:team:list"
        );
    }

    /**
     * 检查当前用户是否是超级管理员
     *
     * @return 是否是超级管理员
     */
    private boolean isSuperAdmin() {
        try {
            // 检查是否已登录
            if (!StpPlatform.STP_LOGIC.isLogin()) {
                return false;
            }

            // 获取当前登录用户名
            String loginId = StpPlatform.STP_LOGIC.getLoginIdAsString();

            // 从环境变量读取超级管理员账号
            String adminUsername = environment.getProperty("proyubi.ops.admin.username");

            if (adminUsername == null) {
                log.warn("proyubi.ops.admin.username 未配置，无法判断是否为超级管理员");
                return false;
            }

            // 判断是否是超级管理员
            return adminUsername.equals(loginId);
        } catch (Exception e) {
            log.warn("检查超级管理员身份失败: {}", e.getMessage());
            return false;
        }
    }
}


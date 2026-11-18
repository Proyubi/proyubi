package ai.proyubi.platform.service;

import ai.proyubi.common.mybatisflex.service.TranslationService;
import ai.proyubi.platform.domain.MenuVO;
import ai.proyubi.platform.domain.RouteItemVO;
import ai.proyubi.platform.domain.SysMenu;
import ai.proyubi.platform.mapper.SysMenuMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 菜单服务
 *
 */
@Service
@RequiredArgsConstructor
public class MenuService {

    private final SysMenuMapper menuMapper;
    private final TranslationService translationService;

    /**
     * 将 MenuVO 转换为 RouteItemVO
     */
    private List<RouteItemVO> convertToRouteItems(List<MenuVO> menus) {
        org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(MenuService.class);
        
        if (menus == null || menus.isEmpty()) {
            log.debug("convertToRouteItems: 输入菜单列表为空");
            return new ArrayList<>();
        }

        log.debug("convertToRouteItems: 开始转换 {} 个菜单", menus.size());
        
        try {
            List<RouteItemVO> result = menus.stream()
                .filter(menu -> {
                    boolean status = menu.getStatus() != null && menu.getStatus();
                    boolean typeMatch = "M".equals(menu.getMenuType()) || "C".equals(menu.getMenuType());
                    if (!status || !typeMatch) {
                        log.debug("菜单被过滤: path={}, status={}, menuType={}",
                            menu.getPath(), status, menu.getMenuType());
                    }
                    return status && typeMatch;
                })
                .map(menu -> {
                    try {
                        RouteItemVO routeItem = new RouteItemVO();
                        routeItem.setPath(menu.getPath());
                        routeItem.setName(menu.getComponentName());
                        routeItem.setComponent(menu.getComponent());

                        // 设置 meta
                        RouteItemVO.RouteMetaVO meta = new RouteItemVO.RouteMetaVO();
                        String menuTitle = menu.getMenuName(); // 应该已经是翻译后的文本
                        log.debug("设置路由项 meta.title: path={}, title={}", menu.getPath(), menuTitle);
                        meta.setTitle(menuTitle); // 直接使用翻译后的字符串
                        meta.setIcon(menu.getIcon());
                        meta.setOrderNo(menu.getOrderNum());
                        // visible=false 的菜单仍注册为路由，但在侧边栏中隐藏
                        meta.setHidden(menu.getVisible() == null || !menu.getVisible());
                        routeItem.setMeta(meta);

                        // 递归处理子菜单
                        if (menu.getChildren() != null && !menu.getChildren().isEmpty()) {
                            log.debug("处理子菜单: path={}, children数量={}", menu.getPath(), menu.getChildren().size());
                            List<RouteItemVO> children = convertToRouteItems(menu.getChildren());
                            routeItem.setChildren(children.isEmpty() ? null : children);
                        }

                        return routeItem;
                    } catch (Exception e) {
                        log.error("转换菜单项失败: path={}, error={}", menu.getPath(), e.getMessage(), e);
                        throw e;
                    }
                })
                .collect(Collectors.toList());
            
            log.debug("convertToRouteItems: 转换完成，共 {} 个路由项", result.size());
            return result;
        } catch (Exception e) {
            log.error("convertToRouteItems 发生异常", e);
            throw e;
        }
    }

    /**
     * 获取指定 App 的菜单列表（转换为前端 RouteItem 格式，按权限过滤）
     *
     * @param appId      App ID
     * @param audience   受众类型（ops/app）
     * @param permissions 用户拥有的权限代码列表
     * @return 菜单树
     */
    public List<RouteItemVO> listMenusAsRouteItemsForApp(UUID appId, String audience, List<String> permissions) {
        org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(MenuService.class);
        try {
            log.debug("=== MenuService.listMenusAsRouteItemsForApp 开始 ===");
            log.debug("appId={}, audience={}, permissions数量={}", appId, audience, permissions != null ? permissions.size() : 0);

            // 查询指定 App 的菜单
            List<SysMenu> menus = menuMapper.selectMenusByApp(appId, audience);
            log.debug("从数据库查询到菜单数量: {}", menus.size());

            if (menus.isEmpty()) {
                log.debug("数据库中没有菜单数据，返回空列表");
                return new ArrayList<>();
            }

            // 转换为 Set 方便查询
            // 如果 permissions 为 null，表示是超级管理员，不进行权限过滤
            boolean skipPermissionCheck = permissions == null;
            Set<String> permissionSet = permissions != null ? new HashSet<>(permissions) : new HashSet<>();

            if (skipPermissionCheck) {
                log.info("超级管理员模式：跳过权限检查，返回所有菜单");
            }

            // 批量翻译菜单名称
            List<String> i18nKeys = menus.stream()
                .map(SysMenu::getMenuName)
                .filter(name -> name != null && !name.isEmpty())
                .distinct()
                .toList();

            Map<String, String> translations = translationService.translateBatch(i18nKeys);

            // 转换为 MenuVO 并翻译，同时按权限过滤
            List<MenuVO> menuVOs = menus.stream()
                .filter(menu -> {
                    // 1. 检查 status（visible 不用于过滤，而是用于设置 meta.hidden）
                    boolean status = menu.getStatus() != null && menu.getStatus();
                    if (!status) {
                        return false;
                    }

                    // 2. 检查权限（如果有 perm_code）
                    // 超级管理员跳过权限检查
                    // 目录类型（M）不按 perm_code 过滤，由 buildMenuTree 中"空目录自动隐藏"逻辑处理
                    if (!skipPermissionCheck && !"M".equals(menu.getMenuType())
                            && menu.getPermCode() != null && !menu.getPermCode().isEmpty()) {
                        if (!permissionSet.contains(menu.getPermCode())) {
                            log.debug("菜单被权限过滤: path={}, perm_code={}", menu.getPath(), menu.getPermCode());
                            return false;
                        }
                    }

                    return true;
                })
                .map(menu -> {
                    MenuVO vo = new MenuVO();
                    vo.setId(menu.getId());
                    String translatedName = translations.getOrDefault(menu.getMenuName(), menu.getMenuName());
                    vo.setMenuName(translatedName);
                    vo.setParentId(menu.getParentId());
                    vo.setOrderNum(menu.getOrderNum());
                    vo.setPath(menu.getPath());
                    vo.setComponent(menu.getComponent());
                    vo.setComponentName(menu.getComponentName());
                    vo.setQueryParam(menu.getQueryParam());
                    vo.setIsFrame(menu.getIsFrame());
                    vo.setIsCache(menu.getIsCache());
                    vo.setMenuType(menu.getMenuType());
                    vo.setVisible(menu.getVisible());
                    vo.setStatus(menu.getStatus());
                    vo.setPerms(menu.getPerms());
                    vo.setIcon(menu.getIcon());
                    vo.setRemark(menu.getRemark());
                    return vo;
                })
                .collect(Collectors.toList());

            log.debug("权限过滤后菜单数量: {}", menuVOs.size());

            // 构建树形结构
            List<MenuVO> menuTree = buildMenuTree(menuVOs, null);
            log.debug("构建菜单树完成，根节点数量: {}", menuTree.size());

            // 转换为 RouteItemVO
            List<RouteItemVO> routeItems = convertToRouteItems(menuTree);
            log.debug("转换为 RouteItemVO 完成，路由项数量: {}", routeItems.size());

            log.debug("=== MenuService.listMenusAsRouteItemsForApp 完成 ===");
            return routeItems;
        } catch (Exception e) {
            log.error("获取菜单列表失败", e);
            return new ArrayList<>();
        }
    }

    /**
     * 构建菜单树
     * 目录类型（M）的菜单如果所有子菜单都被过滤掉，则自动隐藏该目录
     */
    private List<MenuVO> buildMenuTree(List<MenuVO> allMenus, UUID parentId) {
        return allMenus.stream()
            .filter(menu -> {
                if (parentId == null) {
                    return menu.getParentId() == null;
                }
                return parentId.equals(menu.getParentId());
            })
            .peek(menu -> {
                List<MenuVO> children = buildMenuTree(allMenus, menu.getId());
                menu.setChildren(children.isEmpty() ? null : children);
            })
            .filter(menu -> {
                // 目录类型（M）如果没有子菜单，则不显示
                if ("M".equals(menu.getMenuType()) && menu.getChildren() == null) {
                    return false;
                }
                return true;
            })
            .collect(Collectors.toList());
    }
}


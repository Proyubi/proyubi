package ai.proyubi.platform.controller;

import ai.proyubi.common.core.web.R;
import ai.proyubi.common.satoken.stp.StpTenant;
import ai.proyubi.platform.domain.BootstrapVO;
import ai.proyubi.platform.service.BootstrapService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * App Bootstrap 控制器（应用端）
 * 提供应用启动时需要的所有配置数据
 *
 */
@RestController
@RequestMapping("/app/bootstrap")
@RequiredArgsConstructor
public class AppBootstrapController {

    private final BootstrapService bootstrapService;

    /**
     * 获取 Bootstrap 数据（应用端）
     *
     * @param appCode App 代码（如 admin-web）
     */
    @GetMapping("/{appCode}")
    public R<BootstrapVO> getBootstrap(@PathVariable String appCode) {
        StpTenant.checkLogin();
        BootstrapVO bootstrap = bootstrapService.getBootstrap(appCode);
        return R.ok(bootstrap);
    }
}


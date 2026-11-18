package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmTaskService;
import ai.proyubi.pm.vo.PmRoadmapVO;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 路线图Controller（PM）。返回项目内 roadmapVisible=true 的（已汇总）条目。
 *
 */
@RestController
@RequestMapping("/app/pm")
@Validated
public class PmRoadmapController {

    private final PmTaskService taskService;

    public PmRoadmapController(PmTaskService taskService) {
        this.taskService = taskService;
    }

    /** 项目路线图（summary 已汇总，仅 roadmapVisible 条目） */
    @GetMapping("/projects/{projectId}/roadmap")
    public R<PmRoadmapVO> roadmap(@PathVariable UUID projectId) {
        return R.ok(taskService.roadmap(getTenantId(), projectId));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }
}

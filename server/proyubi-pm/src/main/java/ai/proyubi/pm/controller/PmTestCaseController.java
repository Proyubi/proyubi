package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmTestCaseService;
import ai.proyubi.pm.service.PmTestCaseService.CaseInput;
import ai.proyubi.pm.service.PmTestSuiteService;
import ai.proyubi.pm.vo.PmQualitySummaryVO;
import ai.proyubi.pm.vo.PmTestCaseVO;
import ai.proyubi.pm.vo.PmTestSuiteVO;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * 品質管理 Controller：テストスイート／テストケース／実施結果／品質サマリー。
 * ルートは {@code /app/pm/**}。可視性は各 Service が project 経由で担保。
 *
 */
@RestController
@RequestMapping("/app/pm")
public class PmTestCaseController {

    private final PmTestSuiteService suiteService;
    private final PmTestCaseService caseService;

    public PmTestCaseController(PmTestSuiteService suiteService, PmTestCaseService caseService) {
        this.suiteService = suiteService;
        this.caseService = caseService;
    }

    // ---------- テストスイート ----------

    @GetMapping("/customers/{customerId}/test-suites")
    public R<List<PmTestSuiteVO>> listSuites(@PathVariable UUID customerId) {
        return R.ok(suiteService.list(getTenantId(), customerId));
    }

    @PostMapping("/customers/{customerId}/test-suites")
    public R<PmTestSuiteVO> createSuite(@PathVariable UUID customerId, @RequestBody SuiteReq req) {
        return R.ok(suiteService.create(getTenantId(), customerId, req.name(), req.casePrefix(),
            req.description(), req.taskId()));
    }

    @PatchMapping("/test-suites/{id}")
    public R<PmTestSuiteVO> updateSuite(@PathVariable UUID id, @RequestBody SuiteReq req) {
        return R.ok(suiteService.update(getTenantId(), id, req.name(), req.casePrefix(),
            req.description(), req.sortOrder(), req.taskId(),
            req.unlinkTask() != null && req.unlinkTask()));
    }

    @DeleteMapping("/test-suites/{id}")
    public R<Void> deleteSuite(@PathVariable UUID id) {
        suiteService.delete(id, getTenantId());
        return R.ok();
    }

    @GetMapping("/customers/{customerId}/quality-summary")
    public R<PmQualitySummaryVO> summary(@PathVariable UUID customerId) {
        return R.ok(caseService.summary(getTenantId(), customerId));
    }

    // ---------- テストケース ----------

    @GetMapping("/test-suites/{suiteId}/test-cases")
    public R<List<PmTestCaseVO>> listBySuite(@PathVariable UUID suiteId) {
        return R.ok(caseService.listBySuite(getTenantId(), suiteId));
    }

    @GetMapping("/customers/{customerId}/test-cases")
    public R<List<PmTestCaseVO>> listByCustomer(@PathVariable UUID customerId,
                                               @RequestParam(required = false) UUID suiteId,
                                               @RequestParam(required = false) String result,
                                               @RequestParam(required = false) String category,
                                               @RequestParam(required = false) String priority,
                                               @RequestParam(required = false) String keyword) {
        return R.ok(caseService.listByCustomer(getTenantId(), customerId, suiteId, result, category, priority, keyword));
    }

    @PostMapping("/test-suites/{suiteId}/test-cases")
    public R<PmTestCaseVO> createCase(@PathVariable UUID suiteId, @RequestBody CaseInput in) {
        return R.ok(caseService.create(getTenantId(), suiteId, in));
    }

    @PostMapping("/test-suites/{suiteId}/test-cases/batch")
    public R<Integer> batchCreate(@PathVariable UUID suiteId, @RequestBody List<CaseInput> rows) {
        return R.ok(caseService.batchCreate(getTenantId(), suiteId, rows));
    }

    @GetMapping("/test-cases/{id}")
    public R<PmTestCaseVO> getCase(@PathVariable UUID id) {
        return R.ok(caseService.getVO(id, getTenantId()));
    }

    @PatchMapping("/test-cases/{id}")
    public R<PmTestCaseVO> updateCase(@PathVariable UUID id, @RequestBody UpdateCaseReq req) {
        CaseInput in = new CaseInput(req.featureMajor(), req.featureMinor(), req.title(), req.category(),
            req.priority(), req.precondition(), req.steps(), req.testData(), req.expected(), req.remark(),
            null, null);
        return R.ok(caseService.update(id, getTenantId(), in));
    }

    @DeleteMapping("/test-cases/{id}")
    public R<Void> deleteCase(@PathVariable UUID id) {
        caseService.delete(id, getTenantId());
        return R.ok();
    }

    @PatchMapping("/test-cases/{id}/result")
    public R<PmTestCaseVO> updateResult(@PathVariable UUID id, @RequestBody ResultReq req) {
        return R.ok(caseService.updateResult(id, getTenantId(), TenantContext.getUserId(), req.result()));
    }

    @PatchMapping("/test-cases/results/batch")
    public R<Integer> batchResult(@RequestBody BatchResultReq req) {
        return R.ok(caseService.batchResult(getTenantId(), TenantContext.getUserId(), req.caseIds(), req.result()));
    }

    @GetMapping("/tasks/{taskId}/test-cases")
    public R<List<PmTestCaseVO>> listByTask(@PathVariable UUID taskId) {
        return R.ok(caseService.listByTask(getTenantId(), taskId));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }

    public record SuiteReq(String name, String casePrefix, String description, Integer sortOrder,
                           UUID taskId, Boolean unlinkTask) {}

    public record UpdateCaseReq(
        String featureMajor, String featureMinor, String title, String category, String priority,
        String precondition, String steps, String testData, String expected, String remark
    ) {}

    public record ResultReq(String result) {}

    public record BatchResultReq(List<UUID> caseIds, String result) {}
}

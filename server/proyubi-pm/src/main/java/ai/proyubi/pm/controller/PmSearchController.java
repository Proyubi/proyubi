package ai.proyubi.pm.controller;

import ai.proyubi.common.core.context.TenantContext;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.common.core.web.R;
import ai.proyubi.pm.service.PmSearchService;
import ai.proyubi.pm.vo.PmSearchVO;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * PM 横断検索 Controller（コマンドパレット ⌘K 用）。
 *
 */
@RestController
@RequestMapping("/app/pm")
@Validated
public class PmSearchController {

    private final PmSearchService searchService;

    public PmSearchController(PmSearchService searchService) {
        this.searchService = searchService;
    }

    /**
     * タスク / 案件 / バグ票の横断検索。
     *
     * @param keyword 検索語。空なら空結果（前端のデバウンス前でも安全に叩ける）
     * @param types   返す種別のカンマ区切り（"task,project,bug"）。未指定なら全種別
     * @param limit   種別ごとの最大件数（既定 20、上限 50）
     */
    @GetMapping("/search")
    public R<PmSearchVO> search(
        @RequestParam(required = false) String keyword,
        @RequestParam(required = false) String types,
        @RequestParam(required = false, defaultValue = "20") @Min(1) @Max(50) int limit) {
        return R.ok(searchService.search(getTenantId(), keyword, parseTypes(types), limit));
    }

    /** "task, bug" → {task, bug}。空・null は空集合＝全種別扱い。 */
    private static Set<String> parseTypes(String types) {
        if (types == null || types.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(types.split(","))
            .map(String::trim)
            .filter(s -> !s.isEmpty())
            .map(s -> s.toLowerCase())
            .collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private UUID getTenantId() {
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            throw BizException.of(401, "租户信息缺失，请重新登录");
        }
        return tenantId;
    }
}

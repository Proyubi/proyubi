package ai.proyubi.pm.vo;

import java.util.List;
import java.util.UUID;

/**
 * 品質サマリー VO（品質管理）。目次シート相当：スイート別 + プロジェクト合計のロールアップ。
 * 実施結果は latest-result-on-row の集計のみ（軽量）。
 *
 */
public record PmQualitySummaryVO(
    UUID customerId,
    List<SuiteStat> suites,
    SuiteStat total
) {
    /**
     * スイート単位（total は suiteId=null）の集計。
     * executed = pass + fail（対象外/未実施は消化率の分子に含めない）、
     * executionRate = executed / (total - na)、passRate = pass / executed。
     */
    public record SuiteStat(
        UUID suiteId,
        String suiteName,
        int total,
        int pass,
        int fail,
        int na,
        int untested,
        int executed,
        int executionRate,
        int passRate
    ) {}
}

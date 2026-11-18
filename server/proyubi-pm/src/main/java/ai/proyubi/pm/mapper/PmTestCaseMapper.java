package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmTestCase;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.UUID;

/**
 * テストケース Mapper（品質管理）
 *
 */
@Mapper
public interface PmTestCaseMapper extends BaseMapper<PmTestCase> {

    /**
     * スイート内の現在の最大 seq（削除済みを含む＝欠番非再利用）。行が無ければ 0。
     * ux_pm_test_case_seq（NON-partial unique）と組で採番の並行安全を担保。
     */
    @Select("select coalesce(max(seq), 0) from pm_test_case where suite_id = #{suiteId}")
    int maxSeq(@Param("suiteId") UUID suiteId);
}

package ai.proyubi.pm.mapper;

import com.mybatisflex.core.BaseMapper;
import ai.proyubi.pm.domain.PmBug;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import java.util.UUID;

/**
 * バグ票 Mapper（品質管理）
 *
 */
@Mapper
public interface PmBugMapper extends BaseMapper<PmBug> {

    /**
     * 顧客内の現在の最大 seq（削除済みを含む＝欠番非再利用）。行が無ければ 0。
     * ux_pm_bug_seq（NON-partial unique）と組で採番の並行安全を担保。
     */
    @Select("select coalesce(max(seq), 0) from pm_bug where tenant_id = #{tenantId} and customer_id = #{customerId}")
    int maxSeq(@Param("tenantId") UUID tenantId, @Param("customerId") UUID customerId);
}

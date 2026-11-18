package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmSetting;
import ai.proyubi.pm.mapper.PmSettingMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * PM 租户级设置 Service（单行 / 租户）。
 * <p>
 * 目前仅管理 {@code hoursPerWorkday}＝1営業日=何時間（工期 ↔ 時間の換算単位）。
 * {@link #getHoursPerWorkday} 供 {@link TaskRollupService} 及各汇总/负载 Service
 * 在「日 ↔ 分钟」换算时取用；未设置时回退默认 8h，范围外 clamp 到 [1,24]。
 * 写入需 owner 权限（{@link PmTeamScopeService#assertOwner()}）——该值对整个团队的工期口径生效。
 *
 */
@Service
public class PmSettingService {

    /** 未设置时的默认：1営業日 = 8 時間。 */
    public static final double DEFAULT_HOURS_PER_WORKDAY = 8.0;

    /** 合理下限（部分工时也不少于 1h/日） */
    private static final double MIN_HOURS = 1.0;
    /** 合理上限（1 日 ≤ 24h） */
    private static final double MAX_HOURS = 24.0;

    private final PmSettingMapper settingMapper;
    private final PmTeamScopeService teamScope;

    public PmSettingService(PmSettingMapper settingMapper, PmTeamScopeService teamScope) {
        this.settingMapper = settingMapper;
        this.teamScope = teamScope;
    }

    /**
     * 当前租户的「1営業日=何時間」（工期换算单位）。
     * 未设置 → 默认 8；越界/非法 → clamp 到 [1,24]。绝不返回会污染换算的 0/负数/NaN。
     */
    public double getHoursPerWorkday(UUID tenantId) {
        PmSetting s = find(tenantId);
        return clamp(s != null ? s.getHoursPerWorkday() : null);
    }

    /** GET 用：返回当前生效值（含默认回退与 clamp）。 */
    public PmSetting getSettings(UUID tenantId) {
        PmSetting s = find(tenantId);
        if (s == null) {
            s = new PmSetting();
            s.setTenantId(tenantId);
        }
        s.setHoursPerWorkday(clamp(s.getHoursPerWorkday()));
        return s;
    }

    /** 更新「1営業日=何時間」（owner 限定）。范围外 clamp；upsert 单行。 */
    @Transactional
    public PmSetting updateHoursPerWorkday(UUID tenantId, Double hours) {
        teamScope.assertOwner();
        double v = clamp(hours);
        PmSetting s = find(tenantId);
        LocalDateTime now = LocalDateTime.now();
        if (s == null) {
            s = new PmSetting();
            s.setId(UUID.randomUUID());
            s.setTenantId(tenantId);
            s.setHoursPerWorkday(v);
            s.setCreatedAt(now);
            s.setUpdatedAt(now);
            settingMapper.insert(s);
        } else {
            s.setHoursPerWorkday(v);
            s.setUpdatedAt(now);
            settingMapper.update(s);
        }
        return s;
    }

    private PmSetting find(UUID tenantId) {
        return settingMapper.selectOneByQuery(QueryWrapper.create()
            .where(PmSetting::getTenantId).eq(tenantId)
            .limit(1));
    }

    private double clamp(Double h) {
        if (h == null || h.isNaN() || h <= 0) {
            return DEFAULT_HOURS_PER_WORKDAY;
        }
        if (h < MIN_HOURS) {
            return MIN_HOURS;
        }
        return Math.min(h, MAX_HOURS);
    }
}

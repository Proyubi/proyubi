package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmHoliday;
import ai.proyubi.pm.mapper.PmHolidayMapper;
import com.mybatisflex.core.query.QueryWrapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 节假日（红日子 / 祝日）Service（PM）。
 * <p>
 * 租户级、跨项目共享。提供手动 CRUD / 批量导入，以及从 holidays-jp 同步（{@link #syncTenant}）。
 * {@link #getHolidayDates} 供 {@link TaskRollupService} 在按工作日计算工期时排除这些日期。
 *
 */
@Slf4j
@Service
public class PmHolidayService {

    /** 首版仅日本 */
    public static final String DEFAULT_REGION = "JP";

    private static final String SOURCE_MANUAL = "manual";
    private static final String SOURCE_HOLIDAYS_JP = "holidays_jp";

    private final PmHolidayMapper holidayMapper;
    private final HolidaysJpClient holidaysJpClient;
    private final PmTeamScopeService teamScope;
    /** 自身代理：用于让 syncTenant 的 @Transactional 在自调用时仍生效（@Lazy 断开自引用循环） */
    private final PmHolidayService self;

    public PmHolidayService(PmHolidayMapper holidayMapper, HolidaysJpClient holidaysJpClient,
                            PmTeamScopeService teamScope, @Lazy PmHolidayService self) {
        this.holidayMapper = holidayMapper;
        this.holidaysJpClient = holidaysJpClient;
        this.teamScope = teamScope;
        this.self = self;
    }

    /** 列出某租户在 [from, to] 内的节假日（升序）；from/to 可空表示不限。 */
    public List<PmHoliday> list(UUID tenantId, LocalDate from, LocalDate to) {
        QueryWrapper q = QueryWrapper.create()
            .where(PmHoliday::getTenantId).eq(tenantId)
            .and(PmHoliday::getRegion).eq(DEFAULT_REGION)
            .and(PmHoliday::getDeletedAt).isNull();
        if (from != null) {
            q.and(PmHoliday::getHolidayDate).ge(from);
        }
        if (to != null) {
            q.and(PmHoliday::getHolidayDate).le(to);
        }
        q.orderBy(PmHoliday::getHolidayDate, true);
        return holidayMapper.selectListByQuery(q);
    }

    /** 工作日计算用：某租户全部有效节假日日期集合。 */
    public Set<LocalDate> getHolidayDates(UUID tenantId) {
        return list(tenantId, null, null).stream()
            .map(PmHoliday::getHolidayDate)
            .collect(Collectors.toSet());
    }

    public PmHoliday getByIdAndTenant(UUID id, UUID tenantId) {
        PmHoliday h = holidayMapper.selectOneById(id);
        if (h == null || !h.getTenantId().equals(tenantId) || h.getDeletedAt() != null) {
            throw BizException.of(404, "节假日不存在");
        }
        return h;
    }

    /** 手动新增一个红日子（同日期已存在有效记录则拒绝）。 */
    @Transactional
    public PmHoliday create(UUID tenantId, LocalDate date, String name) {
        teamScope.assertOwner();
        if (date == null) {
            throw BizException.of(400, "日期不能为空");
        }
        if (name == null || name.isBlank()) {
            throw BizException.of(400, "名称不能为空");
        }
        if (findActiveByDate(tenantId, date) != null) {
            throw BizException.of(409, "该日期已存在节假日");
        }
        try {
            return insert(tenantId, date, name.trim(), SOURCE_MANUAL, true);
        } catch (DuplicateKeyException e) {
            // 检查-插入存在竞态：并发已插入同日期 → 语义化 409（而非兜底 500）
            throw BizException.of(409, "该日期已存在节假日");
        }
    }

    /** 编辑红日子的日期 / 名称。改为人工维护（is_manual=true），避免被定时同步覆盖。 */
    @Transactional
    public PmHoliday update(UUID id, UUID tenantId, LocalDate date, String name) {
        teamScope.assertOwner();
        PmHoliday h = getByIdAndTenant(id, tenantId);
        if (date != null && !date.equals(h.getHolidayDate())) {
            PmHoliday clash = findActiveByDate(tenantId, date);
            if (clash != null && !clash.getId().equals(id)) {
                throw BizException.of(409, "该日期已存在节假日");
            }
            h.setHolidayDate(date);
        }
        if (name != null && !name.isBlank()) {
            h.setName(name.trim());
        }
        h.setIsManual(true);
        h.setSource(SOURCE_MANUAL);
        h.setUpdatedAt(LocalDateTime.now());
        holidayMapper.update(h);
        return h;
    }

    /** 软删除红日子。注意：删掉同步来的日期后，下次定时同步可能再次补回。 */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        teamScope.assertOwner();
        PmHoliday h = getByIdAndTenant(id, tenantId);
        h.setDeletedAt(LocalDateTime.now());
        h.setUpdatedAt(LocalDateTime.now());
        holidayMapper.update(h);
    }

    /** 批量导入（手动）：跳过已存在日期，返回新增条数。 */
    @Transactional
    public int bulkImport(UUID tenantId, List<ImportRow> rows) {
        teamScope.assertOwner();
        if (rows == null || rows.isEmpty()) {
            return 0;
        }
        Set<LocalDate> existing = getHolidayDates(tenantId);
        int added = 0;
        for (ImportRow row : rows) {
            if (row.date() == null || row.name() == null || row.name().isBlank()) {
                continue;
            }
            if (existing.contains(row.date())) {
                continue;
            }
            try {
                insert(tenantId, row.date(), row.name().trim(), SOURCE_MANUAL, true);
                existing.add(row.date());
                added++;
            } catch (DuplicateKeyException e) {
                // 并发已插入同日期 → 跳过（幂等）
                existing.add(row.date());
            }
        }
        return added;
    }

    /**
     * 把 holidays-jp 拉到的祝日同步进某租户：
     * - 不存在 → 新增（source=holidays_jp, is_manual=false）
     * - 已存在且 is_manual=true → 跳过（人工优先）
     * - 已存在且 is_manual=false 且名称变化 → 更新名称
     * - 落在拉取窗口内、但 feed 已不含的同步行 → 软删除（上游修正/撤销）
     *
     * @return 形如 {added,updated,removed} 的统计
     */
    @Transactional
    public SyncResult syncTenant(UUID tenantId, Map<LocalDate, String> feed) {
        if (feed == null || feed.isEmpty()) {
            return new SyncResult(0, 0, 0);
        }
        LocalDate min = null;
        LocalDate max = null;
        for (LocalDate d : feed.keySet()) {
            if (min == null || d.isBefore(min)) min = d;
            if (max == null || d.isAfter(max)) max = d;
        }
        List<PmHoliday> existing = list(tenantId, null, null);
        Map<LocalDate, PmHoliday> byDate = existing.stream()
            .collect(Collectors.toMap(PmHoliday::getHolidayDate, h -> h, (a, b) -> a));

        int added = 0;
        int updated = 0;
        int removed = 0;
        LocalDateTime now = LocalDateTime.now();

        for (Map.Entry<LocalDate, String> e : feed.entrySet()) {
            PmHoliday cur = byDate.get(e.getKey());
            if (cur == null) {
                try {
                    insert(tenantId, e.getKey(), e.getValue(), SOURCE_HOLIDAYS_JP, false);
                    added++;
                } catch (DuplicateKeyException dup) {
                    // 与「立即同步」/定时同步并发，同日期已被插入 → 跳过
                }
            } else if (!Boolean.TRUE.equals(cur.getIsManual())
                    && !e.getValue().equals(cur.getName())) {
                cur.setName(e.getValue());
                cur.setSource(SOURCE_HOLIDAYS_JP);
                cur.setUpdatedAt(now);
                holidayMapper.update(cur);
                updated++;
            }
        }

        // 窗口内被上游撤销的同步行 → 软删除（人工行不动）
        for (PmHoliday h : existing) {
            LocalDate d = h.getHolidayDate();
            if (Boolean.TRUE.equals(h.getIsManual())) {
                continue;
            }
            if (!d.isBefore(min) && !d.isAfter(max) && !feed.containsKey(d)) {
                h.setDeletedAt(now);
                h.setUpdatedAt(now);
                holidayMapper.update(h);
                removed++;
            }
        }
        return new SyncResult(added, updated, removed);
    }

    /** 当前租户：拉 holidays-jp 并同步（手动「立即同步」按钮用）。 */
    public SyncResult syncFromSource(UUID tenantId) {
        teamScope.assertOwner();
        Map<LocalDate, String> feed;
        try {
            feed = holidaysJpClient.fetch();
        } catch (Exception e) {
            log.error("节假日同步：拉取数据源失败 tenant={} err={}", tenantId, e.getMessage(), e);
            throw BizException.of(502, "节假日数据源拉取失败，请稍后再试");
        }
        // 经自身代理调用，确保 syncTenant 的 @Transactional 生效（自调用否则绕过代理）
        return self.syncTenant(tenantId, feed);
    }

    /** 全租户同步（定时任务用）。拉取失败直接抛出由调用方记录。 */
    public void syncAllTenants() throws Exception {
        Map<LocalDate, String> feed = holidaysJpClient.fetch();
        List<UUID> tenantIds = holidayMapper.listAllTenantIds();
        for (UUID tid : tenantIds) {
            try {
                // 经自身代理调用，使每租户同步落在独立事务（单租户失败不影响其它租户）
                SyncResult r = self.syncTenant(tid, feed);
                if (r.added() + r.updated() + r.removed() > 0) {
                    log.info("节假日同步 tenant={} +{} ~{} -{}", tid, r.added(), r.updated(), r.removed());
                }
            } catch (Exception e) {
                log.error("节假日同步：租户 {} 失败 {}", tid, e.getMessage(), e);
            }
        }
    }

    // ---- helpers ----

    private PmHoliday findActiveByDate(UUID tenantId, LocalDate date) {
        return holidayMapper.selectOneByQuery(QueryWrapper.create()
            .where(PmHoliday::getTenantId).eq(tenantId)
            .and(PmHoliday::getRegion).eq(DEFAULT_REGION)
            .and(PmHoliday::getHolidayDate).eq(date)
            .and(PmHoliday::getDeletedAt).isNull());
    }

    private PmHoliday insert(UUID tenantId, LocalDate date, String name, String source, boolean manual) {
        PmHoliday h = new PmHoliday();
        h.setId(UUID.randomUUID());
        h.setTenantId(tenantId);
        h.setHolidayDate(date);
        h.setName(name);
        h.setRegion(DEFAULT_REGION);
        h.setSource(source);
        h.setIsManual(manual);
        h.setCreatedAt(LocalDateTime.now());
        h.setUpdatedAt(LocalDateTime.now());
        holidayMapper.insert(h);
        return h;
    }

    public record ImportRow(LocalDate date, String name) {
    }

    public record SyncResult(int added, int updated, int removed) {
    }
}

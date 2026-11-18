package ai.proyubi.platform.service;

import com.mybatisflex.core.query.QueryWrapper;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.platform.domain.Plan;
import ai.proyubi.platform.mapper.PlanMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static ai.proyubi.platform.domain.table.PlanTableDef.PLAN;

/**
 * 套餐服务
 *
 */
@Service
@RequiredArgsConstructor
public class PlanService {

    private final PlanMapper planMapper;

    /**
     * 获取所有套餐列表
     */
    public List<Plan> listAll() {
        QueryWrapper queryWrapper = QueryWrapper.create()
            .from(PLAN)
            .where(PLAN.DELETED_AT.isNull())
            .orderBy(PLAN.CREATED_AT.desc());
        return planMapper.selectListByQuery(queryWrapper);
    }

    /**
     * 根据 code 获取套餐
     */
    public Plan getByCode(String code) {
        if (code == null || code.trim().isEmpty()) {
            return null;
        }
        QueryWrapper queryWrapper = QueryWrapper.create()
            .from(PLAN)
            .where(PLAN.CODE.eq(code))
            .and(PLAN.DELETED_AT.isNull());
        return planMapper.selectOneByQuery(queryWrapper);
    }

    /**
     * 根据 ID 获取套餐
     */
    public Plan getById(UUID id) {
        Plan plan = planMapper.selectOneById(id);
        if (plan == null || plan.getDeletedAt() != null) {
            throw BizException.of(404, "套餐不存在");
        }
        return plan;
    }

    /**
     * 创建套餐
     * 注意：价格、货币和计费周期已迁移到 plan_price 表，此处不再使用这些参数
     * 计费周期由 plan_price.interval 控制，支持一个套餐同时有月付和年付价格
     */
    @Transactional
    public Plan create(String code, String name, String description, String status, String features, String remark, String module) {
        // 验证必填字段
        if (code == null || code.trim().isEmpty()) {
            throw BizException.of(400, "套餐代码不能为空");
        }
        if (name == null || name.trim().isEmpty()) {
            throw BizException.of(400, "套餐名称不能为空");
        }

        // 检查 code 是否已存在
        Plan existing = getByCode(code);
        if (existing != null) {
            throw BizException.of(400, "套餐代码已存在: " + code);
        }

        Plan plan = new Plan();
        plan.setId(UUID.randomUUID());
        plan.setCode(code.trim());
        plan.setName(name.trim());
        plan.setDescription(description != null ? description.trim() : null);
        // price 和 currency 字段已废弃，价格管理请使用 plan_price 表
        plan.setPrice(BigDecimal.ZERO);
        plan.setCurrency("USD"); // 保留默认值以兼容数据库约束
        // billingCycle 字段已废弃，计费周期由 plan_price.interval 控制
        plan.setBillingCycle(null);
        plan.setStatus(status != null && !status.trim().isEmpty() ? status.trim() : "active");
        plan.setModule(module != null && !module.trim().isEmpty() ? module.trim() : null);
        plan.setFeatures(features);
        plan.setRemark(remark != null ? remark.trim() : null);
        plan.setCreatedAt(OffsetDateTime.now());
        plan.setUpdatedAt(OffsetDateTime.now());
        planMapper.insert(plan);
        return plan;
    }

    /**
     * 更新套餐
     * 注意：价格、货币和计费周期已迁移到 plan_price 表，此处不再使用这些参数
     * 计费周期由 plan_price.interval 控制，支持一个套餐同时有月付和年付价格
     */
    @Transactional
    public Plan update(UUID id, String name, String description, String status, String features, String remark, String module) {
        Plan plan = getById(id);
        plan.setName(name);
        plan.setDescription(description);
        // price 和 currency 字段已废弃，价格管理请使用 plan_price 表
        // billingCycle 字段已废弃，计费周期由 plan_price.interval 控制
        plan.setStatus(status);
        if (module != null && !module.trim().isEmpty()) {
            plan.setModule(module.trim());
        }
        plan.setFeatures(features);
        plan.setRemark(remark);
        plan.setUpdatedAt(OffsetDateTime.now());
        planMapper.update(plan);
        return plan;
    }

    /**
     * 删除套餐（软删除）
     */
    @Transactional
    public void delete(UUID id) {
        Plan plan = getById(id);
        plan.setDeletedAt(OffsetDateTime.now());
        planMapper.update(plan);
    }
}


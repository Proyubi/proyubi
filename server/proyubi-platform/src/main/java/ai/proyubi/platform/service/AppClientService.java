package ai.proyubi.platform.service;

import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.update.UpdateChain;
import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.platform.domain.AppClient;
import ai.proyubi.platform.mapper.AppClientMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static ai.proyubi.platform.domain.table.AppClientTableDef.APP_CLIENT;

/**
 * App 客户端服务
 *
 */
@Service
@RequiredArgsConstructor
public class AppClientService {

    private final AppClientMapper appClientMapper;

    /**
     * 获取所有 App 客户端列表
     */
    public List<AppClient> listAll() {
        QueryWrapper queryWrapper = QueryWrapper.create()
            .from(APP_CLIENT)
            .where(APP_CLIENT.DELETED_AT.isNull())
            .orderBy(APP_CLIENT.CREATED_AT.desc());
        return appClientMapper.selectListByQuery(queryWrapper);
    }

    /**
     * 根据 app_code 获取 App
     */
    public AppClient getByAppCode(String appCode) {
        QueryWrapper queryWrapper = QueryWrapper.create()
            .from(APP_CLIENT)
            .where(APP_CLIENT.APP_CODE.eq(appCode))
            .and(APP_CLIENT.DELETED_AT.isNull());
        return appClientMapper.selectOneByQuery(queryWrapper);
    }

    /**
     * 根据 ID 获取 App
     */
    public AppClient getById(UUID id) {
        AppClient app = appClientMapper.selectOneById(id);
        if (app == null || app.getDeletedAt() != null) {
            throw BizException.of(404, "App 不存在");
        }
        return app;
    }

    /**
     * 创建 App
     *
     * @param appCode    App 代码
     * @param name       App 名称
     * @param audience   受众类型（ops/app）
     * @param productId  产品ID（可选）
     * @param status     状态
     * @param remark     备注
     * @return 创建的 App
     */
    @Transactional
    public AppClient create(String appCode, String name, String audience, UUID productId, String status, String remark, UUID ossConfigId) {
        // 检查 app_code 是否已存在
        AppClient existing = getByAppCode(appCode);
        if (existing != null) {
            throw BizException.of(400, "App 代码已存在: " + appCode);
        }

        AppClient app = new AppClient();
        app.setId(UUID.randomUUID());
        app.setAppCode(appCode);
        app.setName(name);
        app.setAudience(audience);
        app.setProductId(productId);
        app.setOssConfigId(ossConfigId);
        app.setStatus(status != null ? status : "active");
        app.setRemark(remark);
        app.setCreatedAt(OffsetDateTime.now());
        app.setUpdatedAt(OffsetDateTime.now());
        appClientMapper.insert(app);
        return app;
    }

    /**
     * 更新 App
     *
     * @param id        App ID
     * @param name      App 名称
     * @param audience  受众类型（ops/app）
     * @param productId 产品ID（可选）
     * @param status    状态
     * @param remark    备注
     * @return 更新的 App
     */
    @Transactional
    public AppClient update(UUID id, String name, String audience, UUID productId, String status, String remark, UUID ossConfigId) {
        getById(id); // validate existence

        // Use UpdateChain to explicitly set all fields including null values
        // (BaseMapper.update(entity) ignores null by default, preventing clearing ossConfigId/productId)
        UpdateChain.of(AppClient.class)
            .set(APP_CLIENT.NAME, name)
            .set(APP_CLIENT.AUDIENCE, audience)
            .set(APP_CLIENT.PRODUCT_ID, productId)
            .set(APP_CLIENT.OSS_CONFIG_ID, ossConfigId)
            .set(APP_CLIENT.STATUS, status)
            .set(APP_CLIENT.REMARK, remark)
            .set(APP_CLIENT.UPDATED_AT, OffsetDateTime.now())
            .where(APP_CLIENT.ID.eq(id))
            .update();

        return getById(id);
    }

    /**
     * 删除 App（软删除）
     */
    @Transactional
    public void delete(UUID id) {
        AppClient app = getById(id);
        app.setDeletedAt(OffsetDateTime.now());
        appClientMapper.update(app);
    }
}


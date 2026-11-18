package ai.proyubi.pm.service;

import ai.proyubi.pm.domain.PmBug;
import ai.proyubi.pm.domain.PmComment;
import ai.proyubi.pm.domain.PmDoc;
import ai.proyubi.pm.domain.PmDocTask;
import ai.proyubi.pm.domain.PmEvent;
import ai.proyubi.pm.domain.PmTaskLink;
import ai.proyubi.pm.domain.PmTestCase;
import ai.proyubi.pm.domain.PmTestSuite;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.update.UpdateChain;
import com.mybatisflex.core.util.LambdaGetter;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * PM 级联软删Service。
 * <p>
 * 删除任务 / 项目时，统一把挂在其上的从属子表（评论 pm_comment、链接 pm_task_link、
 * 事件 pm_event、资料对应关系 pm_doc_task / 资料 pm_doc）一并软删，避免每新增一张子表就在 delete 路径漏一处、留下孤儿数据
 * （典型症状：删项目后 owner 日历仍残留指向已删项目的事件）。
 * <p>
 * 全部用 {@link UpdateChain} 批量软删（一类一条 SQL），并显式带 tenant_id 条件做隔离兜底。
 *
 */
@Service
public class PmCascadeService {

    /**
     * 级联软删一批任务的从属：评论 / 链接 / 挂任务的事件。
     * taskIds 为空时直接返回。
     */
    public void cascadeTasks(UUID tenantId, Collection<UUID> taskIds) {
        if (taskIds == null || taskIds.isEmpty()) {
            return;
        }
        List<UUID> ids = new ArrayList<>(taskIds);
        LocalDateTime now = LocalDateTime.now();

        UpdateChain.of(PmComment.class)
            .set(PmComment::getDeletedAt, now)
            .set(PmComment::getUpdatedAt, now)
            .where(PmComment::getTenantId).eq(tenantId)
            .and(PmComment::getTaskId).in(ids)
            .and(PmComment::getDeletedAt).isNull()
            .update();

        // pm_task_link 无 updated_at 列，仅置 deleted_at（与 PmTaskLinkService.delete 一致）
        UpdateChain.of(PmTaskLink.class)
            .set(PmTaskLink::getDeletedAt, now)
            .where(PmTaskLink::getTenantId).eq(tenantId)
            .and(PmTaskLink::getTaskId).in(ids)
            .and(PmTaskLink::getDeletedAt).isNull()
            .update();

        UpdateChain.of(PmEvent.class)
            .set(PmEvent::getDeletedAt, now)
            .set(PmEvent::getUpdatedAt, now)
            .where(PmEvent::getTenantId).eq(tenantId)
            .and(PmEvent::getTaskId).in(ids)
            .and(PmEvent::getDeletedAt).isNull()
            .update();

        // 资料↔任务对应关系（资料本体属于案件/客户，任务删除不删资料）；pm_doc_task 无 updated_at
        UpdateChain.of(PmDocTask.class)
            .set(PmDocTask::getDeletedAt, now)
            .where(PmDocTask::getTenantId).eq(tenantId)
            .and(PmDocTask::getTaskId).in(ids)
            .and(PmDocTask::getDeletedAt).isNull()
            .update();
    }

    /**
     * 级联软删一个项目的从属：先按其任务集软删评论/链接/挂任务的事件，再软删项目级事件
     * （project_id = 该项目）。
     */
    public void cascadeProject(UUID tenantId, UUID projectId, Collection<UUID> taskIds) {
        cascadeTasks(tenantId, taskIds);
        if (projectId == null) {
            return;
        }
        LocalDateTime now = LocalDateTime.now();
        UpdateChain.of(PmEvent.class)
            .set(PmEvent::getDeletedAt, now)
            .set(PmEvent::getUpdatedAt, now)
            .where(PmEvent::getTenantId).eq(tenantId)
            .and(PmEvent::getProjectId).eq(projectId)
            .and(PmEvent::getDeletedAt).isNull()
            .update();
        // 案件资料（含案件フォルダ root）+ 其任务对应关系
        softDeleteDocs(tenantId, PmDoc::getProjectId, projectId, now);
        // 品質管理（スイート／ケース／バグ）は顧客/製品(pm_customer)配下に移行済み。
        // プロジェクト削除では波及させない（版本を跨ぐ資産のため）。顧客削除で PmCustomerService が一括ソフトデリートする。
    }

    /**
     * 顧客/製品削除時に品質管理の従属（スイート／ケース／バグ）を一括ソフトデリート。
     * customer_id 直下の3テーブルを個別に落とす（ケースは suite 経由の孤児防止に customer_id で直接）。
     */
    public void cascadeCustomerQuality(UUID tenantId, UUID customerId) {
        if (customerId == null) {
            return;
        }
        LocalDateTime now = LocalDateTime.now();
        UpdateChain.of(PmTestSuite.class)
            .set(PmTestSuite::getDeletedAt, now)
            .set(PmTestSuite::getUpdatedAt, now)
            .where(PmTestSuite::getTenantId).eq(tenantId)
            .and(PmTestSuite::getCustomerId).eq(customerId)
            .and(PmTestSuite::getDeletedAt).isNull()
            .update();
        UpdateChain.of(PmTestCase.class)
            .set(PmTestCase::getDeletedAt, now)
            .set(PmTestCase::getUpdatedAt, now)
            .where(PmTestCase::getTenantId).eq(tenantId)
            .and(PmTestCase::getCustomerId).eq(customerId)
            .and(PmTestCase::getDeletedAt).isNull()
            .update();
        UpdateChain.of(PmBug.class)
            .set(PmBug::getDeletedAt, now)
            .set(PmBug::getUpdatedAt, now)
            .where(PmBug::getTenantId).eq(tenantId)
            .and(PmBug::getCustomerId).eq(customerId)
            .and(PmBug::getDeletedAt).isNull()
            .update();
    }

    /**
     * 顧客/製品削除時に資料（顧客共通 + 配下案件の資料、各 root 含む）と其任务对应关系を一括ソフトデリート。
     */
    public void cascadeCustomerDocs(UUID tenantId, UUID customerId) {
        if (customerId == null) {
            return;
        }
        softDeleteDocs(tenantId, PmDoc::getCustomerId, customerId, LocalDateTime.now());
    }

    /** 按某列（project_id / customer_id）软删 pm_doc，并先软删其 pm_doc_task（子查询，一类一条 SQL）。 */
    private void softDeleteDocs(UUID tenantId, LambdaGetter<PmDoc> column,
                                UUID value, LocalDateTime now) {
        UpdateChain.of(PmDocTask.class)
            .set(PmDocTask::getDeletedAt, now)
            .where(PmDocTask::getTenantId).eq(tenantId)
            .and(PmDocTask::getDocId).in(
                QueryWrapper.create()
                    .select(PmDoc::getId)
                    .from(PmDoc.class)
                    .where(PmDoc::getTenantId).eq(tenantId)
                    .and(column).eq(value)
                    .and(PmDoc::getDeletedAt).isNull())
            .and(PmDocTask::getDeletedAt).isNull()
            .update();
        UpdateChain.of(PmDoc.class)
            .set(PmDoc::getDeletedAt, now)
            .set(PmDoc::getUpdatedAt, now)
            .where(PmDoc::getTenantId).eq(tenantId)
            .and(column).eq(value)
            .and(PmDoc::getDeletedAt).isNull()
            .update();
    }
}

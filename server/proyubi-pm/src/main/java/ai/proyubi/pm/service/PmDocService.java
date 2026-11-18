package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmCustomer;
import ai.proyubi.pm.domain.PmDoc;
import ai.proyubi.pm.domain.PmDocTask;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmDocMapper;
import ai.proyubi.pm.mapper.PmDocTaskMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import ai.proyubi.pm.mapper.PmTenantUserMapper;
import ai.proyubi.pm.vo.PmDocVO;
import com.mybatisflex.core.query.QueryWrapper;
import com.mybatisflex.core.update.UpdateChain;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 资料Service（PM）。外部网盘资料的链接 + 对应关系（顧客 / 案件 / タスク）。
 * <ul>
 *   <li>provider / kind / externalId 由 url 服务端判定（{@link PmDocUrlParser}），前端不可信。</li>
 *   <li>customerId 登记到案件时由服务端从案件取；任务必须与资料同案件且团队可见。</li>
 *   <li>root（顧客ルート / 案件フォルダ）每个 scope 至多一个：新设时软删旧 root；root 不挂任务。</li>
 *   <li>编辑/删除为任意本租户（团队可见）成员可操作（共享上下文，同 pm_task_link）。</li>
 * </ul>
 * 设计：doc/design/pm-drive-docs.md
 *
 */
@Service
public class PmDocService {

    /** title 最大长度 */
    private static final int MAX_TITLE = 200;
    /** url 最大长度 */
    private static final int MAX_URL = 2000;
    /** mimeType 最大长度 */
    private static final int MAX_MIME = 200;
    /** 批量登记一次最多件数 */
    private static final int MAX_BATCH = 50;
    /** Google ドライブのフォルダの mimeType（Picker から来る） */
    private static final String FOLDER_MIME = "application/vnd.google-apps.folder";

    private final PmDocMapper docMapper;
    private final PmDocTaskMapper docTaskMapper;
    private final PmProjectMapper projectMapper;
    private final PmTaskMapper taskMapper;
    private final PmCustomerService customerService;
    private final PmProjectService projectService;
    private final PmTaskService taskService;
    private final PmTeamScopeService teamScope;
    private final PmMemberResolver memberResolver;
    private final PmTenantUserMapper tenantUserMapper;

    public PmDocService(PmDocMapper docMapper, PmDocTaskMapper docTaskMapper,
                        PmProjectMapper projectMapper, PmTaskMapper taskMapper,
                        PmCustomerService customerService, PmProjectService projectService,
                        PmTaskService taskService, PmTeamScopeService teamScope,
                        PmMemberResolver memberResolver, PmTenantUserMapper tenantUserMapper) {
        this.docMapper = docMapper;
        this.docTaskMapper = docTaskMapper;
        this.projectMapper = projectMapper;
        this.taskMapper = taskMapper;
        this.customerService = customerService;
        this.projectService = projectService;
        this.taskService = taskService;
        this.teamScope = teamScope;
        this.memberResolver = memberResolver;
        this.tenantUserMapper = tenantUserMapper;
    }

    // ------------------------------------------------------------------ 查询

    /**
     * 客户全部资料：顧客共通 + 当前用户团队可见案件的资料（含各 root）。
     * 排序：顧客共通在前，其后按案件名分组；组内 root 在前，再按添加时间升序。
     */
    public List<PmDocVO> listByCustomer(UUID tenantId, UUID customerId) {
        customerService.getByIdAndTenant(customerId, tenantId); // 客户归属 + 团队可见

        Map<UUID, String> visibleProjects = visibleProjectNames(tenantId, customerId);
        List<PmDoc> docs = docMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmDoc::getTenantId).eq(tenantId)
                .and(PmDoc::getCustomerId).eq(customerId)
                .and(PmDoc::getDeletedAt).isNull()
        );
        // 团队可见性在 Java 侧过滤（与 overview / search 一致）：案件资料只留可见案件
        List<PmDoc> filtered = docs.stream()
            .filter(d -> d.getProjectId() == null || visibleProjects.containsKey(d.getProjectId()))
            .sorted(Comparator
                .comparing((PmDoc d) -> d.getProjectId() == null ? 0 : 1)
                .thenComparing(d -> d.getProjectId() == null ? "" : nullToEmpty(visibleProjects.get(d.getProjectId())))
                .thenComparing(d -> d.getProjectId() == null ? "" : d.getProjectId().toString())
                .thenComparing(d -> Boolean.TRUE.equals(d.getIsRoot()) ? 0 : 1)
                .thenComparing(PmDoc::getCreatedAt, Comparator.nullsLast(Comparator.naturalOrder())))
            .toList();
        return toVOs(tenantId, filtered, visibleProjects);
    }

    /** 案件资料（含 root）。root 在前，再按添加时间升序。 */
    public List<PmDocVO> listByProject(UUID tenantId, UUID projectId) {
        PmProject project = projectService.getByIdAndTenant(projectId, tenantId); // 归属 + 团队可见
        List<PmDoc> docs = docMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmDoc::getTenantId).eq(tenantId)
                .and(PmDoc::getProjectId).eq(projectId)
                .and(PmDoc::getDeletedAt).isNull()
                .orderBy(PmDoc::getIsRoot, false)
                .orderBy(PmDoc::getCreatedAt, true)
        );
        Map<UUID, String> names = new HashMap<>();
        names.put(project.getId(), project.getName());
        return toVOs(tenantId, docs, names);
    }

    /** 挂在任务上的资料（按添加时间升序）。 */
    public List<PmDocVO> listByTask(UUID tenantId, UUID taskId) {
        taskService.getVisibleTask(taskId, tenantId); // 归属 + 团队可见
        List<UUID> docIds = docTaskMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmDocTask::getTenantId).eq(tenantId)
                    .and(PmDocTask::getTaskId).eq(taskId)
                    .and(PmDocTask::getDeletedAt).isNull()
            ).stream()
            .map(PmDocTask::getDocId)
            .distinct()
            .toList();
        if (docIds.isEmpty()) {
            return List.of();
        }
        List<PmDoc> docs = docMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmDoc::getTenantId).eq(tenantId)
                .and(PmDoc::getId).in(docIds)
                .and(PmDoc::getDeletedAt).isNull()
                .orderBy(PmDoc::getCreatedAt, true)
        );
        return toVOs(tenantId, docs, null);
    }

    // ------------------------------------------------------------------ 写入

    /**
     * 新增资料。projectId 优先（customerId 从案件取）；二者都没有 → 400。
     * taskIds 需要 projectId，且每个任务属于该案件、团队可见。
     * isRoot=true 时软删同 scope 旧 root 再插入（root 不挂任务）。
     */
    @Transactional
    public PmDocVO create(UUID tenantId, UUID userId, UUID customerId, UUID projectId,
                          String url, String title, String mimeType, List<UUID> taskIds, Boolean isRoot) {
        if (userId == null) {
            throw BizException.of(401, "用户信息缺失，请重新登录");
        }
        String normalizedUrl = normalizeUrl(url);
        boolean root = Boolean.TRUE.equals(isRoot);
        Set<UUID> tasks = distinct(taskIds);

        UUID resolvedCustomerId = resolveCustomerId(tenantId, customerId, projectId);
        if (root && !tasks.isEmpty()) {
            throw BizException.of(400, "根文件夹不能关联任务");
        }
        if (!tasks.isEmpty() && projectId == null) {
            throw BizException.of(400, "关联任务需要指定案件");
        }
        assertTasksInProject(tenantId, projectId, tasks);

        LocalDateTime now = LocalDateTime.now();
        if (root) {
            // 同 scope 旧 root 软删（唯一索引只约束未删除行）；root 不挂任务，无需级联 pm_doc_task
            UpdateChain<PmDoc> chain = UpdateChain.of(PmDoc.class)
                .set(PmDoc::getDeletedAt, now)
                .set(PmDoc::getUpdatedAt, now)
                .where(PmDoc::getTenantId).eq(tenantId)
                .and(PmDoc::getCustomerId).eq(resolvedCustomerId)
                .and(PmDoc::getIsRoot).eq(true)
                .and(PmDoc::getDeletedAt).isNull();
            if (projectId == null) {
                chain.and(PmDoc::getProjectId).isNull();
            } else {
                chain.and(PmDoc::getProjectId).eq(projectId);
            }
            chain.update();
        }

        PmDoc d = insertDoc(tenantId, userId, resolveUserName(tenantId, userId), resolvedCustomerId, projectId,
            root, normalizedUrl, title, mimeType, now);
        for (UUID taskId : tasks) {
            insertDocTask(tenantId, d.getId(), taskId, userId, now);
        }
        return toVOs(tenantId, List.of(d), null).get(0);
    }

    /**
     * 批量登记（Google Picker 多选）。一个事务内登记全部，scope / taskIds 规则同 {@link #create}（不支持 root）。
     * 任一件 url 不合法则整体 400，不做部分成功。
     */
    @Transactional
    public List<PmDocVO> createBatch(UUID tenantId, UUID userId, UUID customerId, UUID projectId,
                                     List<UUID> taskIds, List<BatchItem> items) {
        if (userId == null) {
            throw BizException.of(401, "用户信息缺失，请重新登录");
        }
        if (items == null || items.isEmpty()) {
            throw BizException.of(400, "请至少选择一件资料");
        }
        if (items.size() > MAX_BATCH) {
            throw BizException.of(400, "一次最多登记 " + MAX_BATCH + " 件");
        }
        List<String> urls = items.stream().map(it -> normalizeUrl(it == null ? null : it.url())).toList();
        Set<UUID> tasks = distinct(taskIds);
        UUID resolvedCustomerId = resolveCustomerId(tenantId, customerId, projectId);
        if (!tasks.isEmpty() && projectId == null) {
            throw BizException.of(400, "关联任务需要指定案件");
        }
        assertTasksInProject(tenantId, projectId, tasks);

        LocalDateTime now = LocalDateTime.now();
        String userName = resolveUserName(tenantId, userId);
        List<PmDoc> created = new ArrayList<>(items.size());
        for (int i = 0; i < items.size(); i++) {
            BatchItem it = items.get(i);
            PmDoc d = insertDoc(tenantId, userId, userName, resolvedCustomerId, projectId,
                false, urls.get(i), it.title(), it.mimeType(), now);
            for (UUID taskId : tasks) {
                insertDocTask(tenantId, d.getId(), taskId, userId, now);
            }
            created.add(d);
        }
        return toVOs(tenantId, created, null);
    }

    /** 批量登记的一件：url 必填，title / mimeType 来自 Picker（可空） */
    public record BatchItem(String url, String title, String mimeType) {
    }

    /**
     * 编辑资料：title 非 null 时更新（空白 = 清空）；taskIds 非 null 时整体替换对应关系。
     */
    @Transactional
    public PmDocVO update(UUID id, UUID tenantId, UUID userId, String title, List<UUID> taskIds) {
        PmDoc d = getVisibleDoc(id, tenantId);
        LocalDateTime now = LocalDateTime.now();

        if (taskIds != null) {
            Set<UUID> wanted = distinct(taskIds);
            if (!wanted.isEmpty()) {
                if (Boolean.TRUE.equals(d.getIsRoot())) {
                    throw BizException.of(400, "根文件夹不能关联任务");
                }
                if (d.getProjectId() == null) {
                    throw BizException.of(400, "顧客共通资料不能关联任务");
                }
            }
            assertTasksInProject(tenantId, d.getProjectId(), wanted);

            List<PmDocTask> current = docTaskMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmDocTask::getTenantId).eq(tenantId)
                    .and(PmDocTask::getDocId).eq(d.getId())
                    .and(PmDocTask::getDeletedAt).isNull()
            );
            Set<UUID> existing = new LinkedHashSet<>();
            List<UUID> removeIds = new ArrayList<>();
            for (PmDocTask dt : current) {
                if (wanted.contains(dt.getTaskId()) && existing.add(dt.getTaskId())) {
                    continue; // 保留不变的对应关系（保留其 created_at）
                }
                removeIds.add(dt.getId());
            }
            if (!removeIds.isEmpty()) {
                UpdateChain.of(PmDocTask.class)
                    .set(PmDocTask::getDeletedAt, now)
                    .where(PmDocTask::getTenantId).eq(tenantId)
                    .and(PmDocTask::getId).in(removeIds)
                    .update();
            }
            for (UUID taskId : wanted) {
                if (!existing.contains(taskId)) {
                    insertDocTask(tenantId, d.getId(), taskId, userId, now);
                }
            }
        }

        if (title != null) {
            d.setTitle(normalizeTitle(title));
        }
        d.setUpdatedAt(now);
        docMapper.update(d, false); // ignoreNulls=false：允许把 title 清成 null（实体为整行读出，其余列原样写回）
        return toVOs(tenantId, List.of(d), null).get(0);
    }

    /** 软删除资料及其任务对应关系（任意本租户、团队可见成员可操作）。 */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmDoc d = getVisibleDoc(id, tenantId);
        LocalDateTime now = LocalDateTime.now();
        UpdateChain.of(PmDocTask.class)
            .set(PmDocTask::getDeletedAt, now)
            .where(PmDocTask::getTenantId).eq(tenantId)
            .and(PmDocTask::getDocId).eq(d.getId())
            .and(PmDocTask::getDeletedAt).isNull()
            .update();
        d.setDeletedAt(now);
        d.setUpdatedAt(now);
        docMapper.update(d);
    }

    // ------------------------------------------------------------------ 内部

    /** projectId 优先（customerId 从案件取，不信前端）；二者都没有 → 400。同时校验归属 + 团队可见。 */
    private UUID resolveCustomerId(UUID tenantId, UUID customerId, UUID projectId) {
        if (projectId != null) {
            PmProject project = projectService.getByIdAndTenant(projectId, tenantId);
            if (project.getCustomerId() == null) {
                throw BizException.of(400, "案件未关联客户");
            }
            return project.getCustomerId();
        }
        if (customerId != null) {
            PmCustomer customer = customerService.getByIdAndTenant(customerId, tenantId);
            return customer.getId();
        }
        throw BizException.of(400, "customerId 与 projectId 至少需要一个");
    }

    /** 插入一件资料（url 已规整）。provider / kind / externalId 由 url 服务端判定。 */
    private PmDoc insertDoc(UUID tenantId, UUID userId, String userName, UUID customerId, UUID projectId,
                            boolean root, String normalizedUrl, String title, String mimeType, LocalDateTime now) {
        PmDocUrlParser.Result parsed = PmDocUrlParser.parse(normalizedUrl);
        // フォルダは顧客ルート / 案件フォルダとしてだけ持つ（資料として登録すると 1 画面に複数のフォルダが並ぶ）
        if (!root && (PmDocUrlParser.KIND_GFOLDER.equals(parsed.kind()) || FOLDER_MIME.equals(mimeType))) {
            throw BizException.of(400, "文件夹不能作为资料登记，请设为顧客ルートフォルダ或案件フォルダ");
        }
        PmDoc d = new PmDoc();
        d.setId(UUID.randomUUID());
        d.setTenantId(tenantId);
        d.setCustomerId(customerId);
        d.setProjectId(projectId);
        d.setIsRoot(root);
        d.setUrl(normalizedUrl);
        d.setProvider(parsed.provider());
        d.setKind(parsed.kind());
        d.setExternalId(parsed.externalId());
        d.setTitle(normalizeTitle(title));
        d.setMimeType(normalizeMimeType(mimeType));
        d.setCreatedBy(userId);
        d.setCreatedByName(userName);
        d.setCreatedAt(now);
        d.setUpdatedAt(now);
        docMapper.insert(d);
        return d;
    }

    /** 取资料并校验：本租户、未删除、所属案件（或顧客共通时的客户）团队可见；否则 404。 */
    private PmDoc getVisibleDoc(UUID id, UUID tenantId) {
        PmDoc d = docMapper.selectOneById(id);
        if (d == null || !tenantId.equals(d.getTenantId()) || d.getDeletedAt() != null) {
            throw BizException.of(404, "资料不存在");
        }
        if (d.getProjectId() != null) {
            projectService.getByIdAndTenant(d.getProjectId(), tenantId);
        } else {
            customerService.getByIdAndTenant(d.getCustomerId(), tenantId);
        }
        return d;
    }

    /** 每个任务须属于本租户、团队可见，且挂在指定案件下。 */
    private void assertTasksInProject(UUID tenantId, UUID projectId, Set<UUID> taskIds) {
        for (UUID taskId : taskIds) {
            PmTask t = taskService.getVisibleTask(taskId, tenantId);
            if (projectId == null || !projectId.equals(t.getProjectId())) {
                throw BizException.of(400, "任务不属于该案件");
            }
        }
    }

    private void insertDocTask(UUID tenantId, UUID docId, UUID taskId, UUID userId, LocalDateTime now) {
        PmDocTask dt = new PmDocTask();
        dt.setId(UUID.randomUUID());
        dt.setTenantId(tenantId);
        dt.setDocId(docId);
        dt.setTaskId(taskId);
        dt.setCreatedBy(userId);
        dt.setCreatedAt(now);
        docTaskMapper.insert(dt);
    }

    /** 客户下当前用户团队可见的案件 id → 名称。 */
    private Map<UUID, String> visibleProjectNames(UUID tenantId, UUID customerId) {
        List<UUID> teamIds = teamScope.visibleTeamIds();
        Map<UUID, String> result = new HashMap<>();
        if (teamIds != null && teamIds.isEmpty()) {
            return result; // member 不属于任何团队
        }
        List<PmProject> projects = projectMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmProject::getTenantId).eq(tenantId)
                .and(PmProject::getCustomerId).eq(customerId)
                .and(PmProject::getDeletedAt).isNull()
        );
        for (PmProject p : projects) {
            // team_id 为 null（历史数据）放行，与 assertTeamVisible 一致
            if (teamIds == null || p.getTeamId() == null || teamIds.contains(p.getTeamId())) {
                result.put(p.getId(), p.getName());
            }
        }
        return result;
    }

    /**
     * 批量组装 VO：一次查对应关系、一次查任务名、（必要时）一次查案件名，避免 N+1。
     * knownProjectNames 已含的案件不再查。
     */
    private List<PmDocVO> toVOs(UUID tenantId, List<PmDoc> docs, Map<UUID, String> knownProjectNames) {
        if (docs.isEmpty()) {
            return List.of();
        }
        List<UUID> docIds = docs.stream().map(PmDoc::getId).toList();

        // 资料 → 任务对应关系
        List<PmDocTask> links = docTaskMapper.selectListByQuery(
            QueryWrapper.create()
                .where(PmDocTask::getTenantId).eq(tenantId)
                .and(PmDocTask::getDocId).in(docIds)
                .and(PmDocTask::getDeletedAt).isNull()
                .orderBy(PmDocTask::getCreatedAt, true)
        );
        Map<UUID, String> taskNames = new HashMap<>();
        if (!links.isEmpty()) {
            List<UUID> taskIds = links.stream().map(PmDocTask::getTaskId).distinct().toList();
            for (PmTask t : taskMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmTask::getTenantId).eq(tenantId)
                    .and(PmTask::getId).in(taskIds)
                    .and(PmTask::getDeletedAt).isNull())) {
                taskNames.put(t.getId(), t.getName());
            }
        }
        Map<UUID, List<PmDocVO.TaskRef>> tasksByDoc = new HashMap<>();
        for (PmDocTask l : links) {
            if (!taskNames.containsKey(l.getTaskId())) {
                continue; // 任务已删（级联未覆盖的历史数据）→ 不展示
            }
            tasksByDoc.computeIfAbsent(l.getDocId(), k -> new ArrayList<>())
                .add(new PmDocVO.TaskRef(l.getTaskId(), taskNames.get(l.getTaskId())));
        }

        // 案件名
        Map<UUID, String> projectNames = knownProjectNames == null ? new HashMap<>() : new HashMap<>(knownProjectNames);
        List<UUID> missing = docs.stream()
            .map(PmDoc::getProjectId)
            .filter(pid -> pid != null && !projectNames.containsKey(pid))
            .distinct()
            .toList();
        if (!missing.isEmpty()) {
            for (PmProject p : projectMapper.selectListByQuery(
                QueryWrapper.create()
                    .where(PmProject::getTenantId).eq(tenantId)
                    .and(PmProject::getId).in(missing))) {
                projectNames.put(p.getId(), p.getName());
            }
        }

        List<PmDocVO> result = new ArrayList<>(docs.size());
        for (PmDoc d : docs) {
            result.add(new PmDocVO(
                d.getId(),
                d.getCustomerId(),
                d.getProjectId(),
                d.getProjectId() == null ? null : projectNames.get(d.getProjectId()),
                d.getUrl(),
                d.getProvider(),
                d.getKind(),
                d.getExternalId(),
                PmDocUrlParser.previewUrl(d.getKind(), d.getExternalId()),
                d.getTitle(),
                d.getMimeType(),
                Boolean.TRUE.equals(d.getIsRoot()),
                tasksByDoc.getOrDefault(d.getId(), List.of()),
                d.getCreatedBy(),
                d.getCreatedByName(),
                d.getCreatedAt()
            ));
        }
        return result;
    }

    /** 添加人显示名：优先 PM 成员名，否则回退租户用户 display_name，再否则「—」（同 PmCommentService）。 */
    private String resolveUserName(UUID tenantId, UUID userId) {
        PmMember member = memberResolver.findMember(tenantId, userId);
        if (member != null && member.getName() != null && !member.getName().isBlank()) {
            return member.getName();
        }
        String name = tenantUserMapper.findDisplayName(tenantId, userId);
        if (name != null && !name.isBlank()) {
            return name;
        }
        return "—";
    }

    /** 校验并规整 url：非空、http(s)、长度限制（同 PmTaskLinkService）。 */
    private String normalizeUrl(String url) {
        if (url == null || url.isBlank()) {
            throw BizException.of(400, "链接不能为空");
        }
        String u = url.trim();
        String lower = u.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            throw BizException.of(400, "链接必须以 http:// 或 https:// 开头");
        }
        if (u.length() > MAX_URL) {
            throw BizException.of(400, "链接过长");
        }
        return u;
    }

    private String normalizeTitle(String title) {
        if (title == null) {
            return null;
        }
        String t = title.trim();
        if (t.isEmpty()) {
            return null;
        }
        return t.length() > MAX_TITLE ? t.substring(0, MAX_TITLE) : t;
    }

    /** mimeType：去空白、限长；形如 type/subtype 以外的值丢弃（只用于前端图标判定） */
    private static String normalizeMimeType(String mimeType) {
        if (mimeType == null) {
            return null;
        }
        String m = mimeType.trim();
        if (m.isEmpty() || m.length() > MAX_MIME || !m.matches("[A-Za-z0-9.+_-]+/[A-Za-z0-9.+_-]+")) {
            return null;
        }
        return m;
    }

    private static Set<UUID> distinct(List<UUID> ids) {
        Set<UUID> set = new LinkedHashSet<>();
        if (ids != null) {
            for (UUID id : ids) {
                if (id != null) {
                    set.add(id);
                }
            }
        }
        return set;
    }

    private static String nullToEmpty(String s) {
        return s == null ? "" : s;
    }
}

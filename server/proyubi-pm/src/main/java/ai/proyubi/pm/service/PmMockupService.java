package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmBug;
import ai.proyubi.pm.domain.PmCustomer;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.domain.PmMockup;
import ai.proyubi.pm.domain.PmMockupFile;
import ai.proyubi.pm.domain.PmMockupVersion;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmBugMapper;
import ai.proyubi.pm.mapper.PmCustomerMapper;
import ai.proyubi.pm.mapper.PmMockupFileMapper;
import ai.proyubi.pm.mapper.PmMockupMapper;
import ai.proyubi.pm.mapper.PmMockupVersionMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import ai.proyubi.pm.mapper.PmTenantUserMapper;
import ai.proyubi.pm.vo.PmMockupVO;
import com.mybatisflex.core.query.QueryWrapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * モックアップService（PM）。HTML / zip の効果図を版ごとに保存し、社内プレビュー用の署名 URL と
 * 社外向け共有リンクを発行する。設計：doc/design/pm-mockup.md
 * <ul>
 *   <li>入口 HTML は pm_mockup_version.content、zip の付属ファイルは pm_mockup_file（{@link PmMockupBundle}）。</li>
 *   <li>紐付け先（案件 / タスク / バグ）から customer / project をサーバ側で導出（前端は信用しない）。</li>
 *   <li>可視性：案件があれば案件の団队可视、なければ顧客の団队可视。編集・削除は可視メンバー全員（pm_task_link と同じ共有コンテキスト）。</li>
 *   <li>最新版と同一内容（sha256 一致）の再公開は新版を作らない。</li>
 *   <li>版番号は再利用しない（削除済み版を含めた最大値 + 1）。</li>
 * </ul>
 *
 */
@Service
public class PmMockupService {

    /** title 最大長 */
    private static final int MAX_TITLE = 200;
    /** note 最大長 */
    private static final int MAX_NOTE = 500;
    /** 署名付き原文 URL の有効時間 */
    private static final long VIEW_URL_TTL_SECONDS = 2 * 60 * 60;
    /** タイトル未指定かつ HTML に title が無い場合 */
    private static final String DEFAULT_TITLE = "無題のモックアップ";
    private static final Pattern HTML_TITLE = Pattern.compile("<title[^>]*>(.*?)</title>",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    private final PmMockupMapper mockupMapper;
    private final PmMockupVersionMapper versionMapper;
    private final PmMockupFileMapper fileMapper;
    private final PmProjectMapper projectMapper;
    private final PmTaskMapper taskMapper;
    private final PmBugMapper bugMapper;
    private final PmCustomerMapper customerMapper;
    private final PmProjectService projectService;
    private final PmCustomerService customerService;
    private final PmTaskService taskService;
    private final PmBugService bugService;
    private final PmMemberResolver memberResolver;
    private final PmTenantUserMapper tenantUserMapper;
    private final PmMockupUrlSigner signer;
    private final PmMockupBundle.Limits limits;
    private final int maxZipBytes;

    public PmMockupService(PmMockupMapper mockupMapper, PmMockupVersionMapper versionMapper,
                           PmMockupFileMapper fileMapper,
                           PmProjectMapper projectMapper, PmTaskMapper taskMapper, PmBugMapper bugMapper,
                           PmCustomerMapper customerMapper, PmProjectService projectService,
                           PmCustomerService customerService, PmTaskService taskService,
                           PmBugService bugService, PmMemberResolver memberResolver,
                           PmTenantUserMapper tenantUserMapper, PmMockupUrlSigner signer,
                           @Value("${proyubi.pm.mockup.max-bytes:5242880}") int maxBytes,
                           @Value("${proyubi.pm.mockup.max-zip-bytes:52428800}") int maxZipBytes,
                           @Value("${proyubi.pm.mockup.max-total-bytes:104857600}") int maxTotalBytes,
                           @Value("${proyubi.pm.mockup.max-files:500}") int maxFiles) {
        this.mockupMapper = mockupMapper;
        this.versionMapper = versionMapper;
        this.fileMapper = fileMapper;
        this.projectMapper = projectMapper;
        this.taskMapper = taskMapper;
        this.bugMapper = bugMapper;
        this.customerMapper = customerMapper;
        this.projectService = projectService;
        this.customerService = customerService;
        this.taskService = taskService;
        this.bugService = bugService;
        this.memberResolver = memberResolver;
        this.tenantUserMapper = tenantUserMapper;
        this.signer = signer;
        this.limits = new PmMockupBundle.Limits(maxBytes, maxTotalBytes, maxFiles);
        this.maxZipBytes = maxZipBytes;
    }

    /**
     * 公開（新規 or 新版）の入力。mockupId 指定時は紐付けパラメータを無視して新版を追加する。
     * bundle は {@link #readHtml} / {@link #readZip} / {@link #readFiles} で作る。
     */
    public record PublishInput(PmMockupBundle bundle, String title, UUID projectId, UUID taskId, UUID bugId,
                               UUID mockupId, String note) {
    }

    /** 配信する 1 ファイル */
    public record Served(String contentType, byte[] body) {
    }

    // ------------------------------------------------------------------ 内容の読み込み（上限・パス検査はここで）

    public PmMockupBundle readHtml(String html) {
        return PmMockupBundle.ofHtml(html, limits);
    }

    /** zip 本体の上限は画面アップロード（multipart）と MCP（zipBase64）の両方でここで見る。 */
    public PmMockupBundle readZip(byte[] zip) {
        if (zip != null && zip.length > maxZipBytes) {
            throw BizException.of(400, "zip が大きすぎます（上限 " + (maxZipBytes / 1024 / 1024) + "MB）");
        }
        return PmMockupBundle.ofZip(zip, limits);
    }

    public PmMockupBundle readFiles(List<PmMockupBundle.RawFile> files) {
        return PmMockupBundle.ofFiles(files, limits);
    }

    // ------------------------------------------------------------------ 查询

    /** 案件 / タスク / バグ いずれか 1 つで一覧。更新が新しい順。 */
    public List<PmMockupVO> list(UUID tenantId, UUID projectId, UUID taskId, UUID bugId) {
        QueryWrapper q = QueryWrapper.create()
            .where(PmMockup::getTenantId).eq(tenantId)
            .and(PmMockup::getDeletedAt).isNull();
        if (taskId != null) {
            taskService.getVisibleTask(taskId, tenantId);
            q.and(PmMockup::getTaskId).eq(taskId);
        } else if (bugId != null) {
            bugService.getVisibleBug(bugId, tenantId);
            q.and(PmMockup::getBugId).eq(bugId);
        } else if (projectId != null) {
            projectService.getByIdAndTenant(projectId, tenantId);
            q.and(PmMockup::getProjectId).eq(projectId);
        } else {
            throw BizException.of(400, "projectId / taskId / bugId のいずれかを指定してください");
        }
        q.orderBy(PmMockup::getUpdatedAt, false);
        return toVOs(mockupMapper.selectListByQuery(q), false);
    }

    /** 詳細（版一覧つき）。 */
    public PmMockupVO get(UUID id, UUID tenantId) {
        return toVOs(List.of(getVisible(id, tenantId)), true).get(0);
    }

    // ------------------------------------------------------------------ 公開

    /** 新規公開または新版の追加。via = web / mcp。 */
    @Transactional
    public PmMockupVO publish(UUID tenantId, UUID userId, PublishInput in, String via) {
        if (userId == null) {
            throw BizException.of(400, "公開者が特定できません（ユーザー情報なし）");
        }
        PmMockupBundle bundle = in.bundle();
        if (bundle == null) {
            throw BizException.of(400, "HTML が空です");
        }
        String sha = bundle.sha256();
        String userName = resolveUserName(tenantId, userId);
        LocalDateTime now = LocalDateTime.now();

        PmMockup m;
        if (in.mockupId() != null) {
            m = getVisible(in.mockupId(), tenantId);
            PmMockupVersion latest = latestVersion(m.getId());
            if (latest != null && sha.equals(latest.getSha256())) {
                return get(m.getId(), tenantId); // 同一内容：新版を作らない
            }
            String title = normalizeTitle(in.title());
            if (title != null) {
                m.setTitle(title);
            }
        } else {
            Scope scope = resolveScope(tenantId, in.projectId(), in.taskId(), in.bugId());
            m = new PmMockup();
            m.setId(UUID.randomUUID());
            m.setTenantId(tenantId);
            m.setCustomerId(scope.customerId());
            m.setProjectId(scope.projectId());
            m.setTaskId(in.taskId());
            m.setBugId(in.bugId());
            String title = normalizeTitle(in.title());
            if (title == null) {
                title = extractHtmlTitle(bundle.entryHtml());
            }
            m.setTitle(title == null ? DEFAULT_TITLE : title);
            m.setCurrentVersion(0);
            m.setShareEnabled(false);
            m.setShareViewCount(0);
            m.setCreatedBy(userId);
            m.setCreatedByName(userName);
            m.setCreatedAt(now);
            m.setUpdatedAt(now);
            mockupMapper.insert(m);
        }

        PmMockupVersion v = new PmMockupVersion();
        v.setId(UUID.randomUUID());
        v.setTenantId(tenantId);
        v.setMockupId(m.getId());
        v.setVersion(versionMapper.selectMaxVersion(m.getId()) + 1);
        v.setContent(bundle.entryHtml());
        v.setEntryPath(bundle.entryPath());
        v.setFileCount(bundle.fileCount());
        v.setSizeBytes(bundle.totalBytes());
        v.setSha256(sha);
        v.setNote(truncate(in.note(), MAX_NOTE));
        v.setVia("mcp".equals(via) ? "mcp" : "web");
        v.setCreatedBy(userId);
        v.setCreatedByName(userName);
        v.setCreatedAt(now);
        versionMapper.insert(v);
        for (PmMockupBundle.Asset a : bundle.assets()) {
            PmMockupFile f = new PmMockupFile();
            f.setId(UUID.randomUUID());
            f.setTenantId(tenantId);
            f.setVersionId(v.getId());
            f.setPath(a.path());
            f.setContentType(a.contentType());
            f.setSizeBytes(a.data().length);
            f.setData(a.data());
            f.setCreatedAt(now);
            fileMapper.insert(f);
        }

        m.setCurrentVersion(v.getVersion());
        m.setUpdatedAt(now);
        mockupMapper.update(m);
        return get(m.getId(), tenantId);
    }

    // ------------------------------------------------------------------ 编辑 / 删除

    /** メタ情報の変更（タイトル・紐付けタスク / バグ）。案件の付け替えはしない。 */
    @Transactional
    public PmMockupVO update(UUID id, UUID tenantId, String title, UUID taskId, UUID bugId,
                             boolean clearTask, boolean clearBug) {
        PmMockup m = getVisible(id, tenantId);
        UUID newTask = clearTask ? null : (taskId != null ? taskId : m.getTaskId());
        UUID newBug = clearBug ? null : (bugId != null ? bugId : m.getBugId());
        if (taskId != null && !clearTask) {
            PmTask t = taskService.getVisibleTask(taskId, tenantId);
            if (m.getProjectId() == null || !m.getProjectId().equals(t.getProjectId())) {
                throw BizException.of(400, "同じ案件のタスクにのみ紐付けできます");
            }
        }
        if (bugId != null && !clearBug) {
            PmBug b = bugService.getVisibleBug(bugId, tenantId);
            if (!m.getCustomerId().equals(b.getCustomerId())
                || (b.getProjectId() != null && m.getProjectId() != null && !m.getProjectId().equals(b.getProjectId()))) {
                throw BizException.of(400, "同じ案件のバグにのみ紐付けできます");
            }
        }
        if (newTask == null && newBug == null && m.getProjectId() == null) {
            throw BizException.of(400, "案件に属さないモックアップはバグの紐付けを外せません");
        }
        String newTitle = normalizeTitle(title);
        if (newTitle != null) {
            m.setTitle(newTitle);
        }
        m.setTaskId(newTask);
        m.setBugId(newBug);
        m.setUpdatedAt(LocalDateTime.now());
        save(m);
        return get(id, tenantId);
    }

    /** モックアップごと軟削除（共有リンクも無効化）。 */
    @Transactional
    public void delete(UUID id, UUID tenantId) {
        PmMockup m = getVisible(id, tenantId);
        m.setDeletedAt(LocalDateTime.now());
        m.setShareEnabled(false);
        save(m);
    }

    /** 1 版を軟削除。最後の 1 版は消せない。最新版を消したら残りの最大版に戻す。 */
    @Transactional
    public PmMockupVO deleteVersion(UUID id, UUID tenantId, int version) {
        PmMockup m = getVisible(id, tenantId);
        List<PmMockupVersion> versions = versionMapper.selectMetaByMockup(id);
        PmMockupVersion target = versions.stream()
            .filter(v -> v.getVersion() == version).findFirst()
            .orElseThrow(() -> BizException.of(404, "版が存在しません"));
        if (versions.size() <= 1) {
            throw BizException.of(400, "最後の版は削除できません。モックアップごと削除してください");
        }
        versionMapper.softDelete(target.getId());
        m.setCurrentVersion(versions.stream().mapToInt(PmMockupVersion::getVersion)
            .filter(n -> n != version).max().orElse(0));
        if (Objects.equals(m.getSharePinnedVersion(), version)) {
            m.setSharePinnedVersion(null);
        }
        m.setUpdatedAt(LocalDateTime.now());
        save(m);
        return get(id, tenantId);
    }

    // ------------------------------------------------------------------ 预览 / 共享

    /** 社内プレビュー用の署名付き原文 URL。version 省略 = 最新版。 */
    public PmMockupVO.ViewUrl viewUrl(UUID id, UUID tenantId, Integer version) {
        PmMockup m = getVisible(id, tenantId);
        PmMockupVersion v = findVersion(m.getId(), version != null ? version : m.getCurrentVersion());
        if (v == null) {
            throw BizException.of(404, "版が存在しません");
        }
        return signedUrl(v);
    }

    /** 共有設定。enabled=true で未発行ならトークンを発行。expiresInDays null = 無期限、pinnedVersion null = 常に最新。 */
    @Transactional
    public PmMockupVO updateShare(UUID id, UUID tenantId, boolean enabled, Integer expiresInDays,
                                  Integer pinnedVersion) {
        PmMockup m = getVisible(id, tenantId);
        if (expiresInDays != null && (expiresInDays < 1 || expiresInDays > 365)) {
            throw BizException.of(400, "有効期限は 1〜365 日で指定してください");
        }
        if (pinnedVersion != null && findVersion(id, pinnedVersion) == null) {
            throw BizException.of(400, "固定する版が存在しません");
        }
        String token = m.getShareToken();
        if (enabled && token == null) {
            token = PmMockupUrlSigner.newShareToken();
        }
        m.setShareEnabled(enabled);
        m.setShareToken(token);
        m.setShareExpiresAt(expiresInDays == null ? null : LocalDateTime.now().plusDays(expiresInDays));
        m.setSharePinnedVersion(pinnedVersion);
        save(m);
        return get(id, tenantId);
    }

    /** 共有トークンの再発行（旧リンクは即無効）。 */
    @Transactional
    public PmMockupVO regenerateShare(UUID id, UUID tenantId) {
        PmMockup m = getVisible(id, tenantId);
        m.setShareToken(PmMockupUrlSigner.newShareToken());
        m.setShareViewCount(0);
        m.setShareLastViewedAt(null);
        save(m);
        return get(id, tenantId);
    }

    /** MCP から「共有リンクも作って」と言われた場合：未有効なら 30 日で有効化、有効ならそのまま。 */
    @Transactional
    public PmMockupVO ensureShared(UUID id, UUID tenantId) {
        PmMockup m = getVisible(id, tenantId);
        if (Boolean.TRUE.equals(m.getShareEnabled()) && !isExpired(m)) {
            return get(id, tenantId);
        }
        return updateShare(id, tenantId, true, 30, m.getSharePinnedVersion());
    }

    /**
     * 公開共有ページ（ログイン不要）。無効・停止・期限切れ・削除済みは区別せず null（呼び出し側で 404）。
     * 閲覧回数を 1 加算する。
     */
    @Transactional
    public PmMockupVO.PublicShare publicShare(String token) {
        if (token == null || token.isBlank() || token.length() > 64) {
            return null;
        }
        PmMockup m = mockupMapper.selectOneByQuery(QueryWrapper.create()
            .where(PmMockup::getShareToken).eq(token)
            .and(PmMockup::getDeletedAt).isNull());
        if (m == null || !Boolean.TRUE.equals(m.getShareEnabled()) || isExpired(m)) {
            return null;
        }
        PmMockupVersion v = m.getSharePinnedVersion() != null ? findVersion(m.getId(), m.getSharePinnedVersion()) : null;
        if (v == null) {
            v = findVersion(m.getId(), m.getCurrentVersion());
        }
        if (v == null) {
            return null;
        }
        mockupMapper.incrementShareView(m.getId());
        PmCustomer customer = customerMapper.selectOneById(m.getCustomerId());
        PmProject project = m.getProjectId() == null ? null : projectMapper.selectOneById(m.getProjectId());
        return new PmMockupVO.PublicShare(
            m.getTitle(),
            customer == null ? null : customer.getName(),
            project == null ? null : project.getName(),
            v.getVersion(),
            v.getCreatedAt(),
            m.getShareExpiresAt(),
            signedUrl(v).url());
    }

    /**
     * 署名検証済みの版 id とパス（{@link PmMockupBundle#normalizeRequestPath} 済み）から 1 ファイルを取得。
     * 入口 HTML は content、それ以外は pm_mockup_file。版・モックアップが削除済み、またはファイルが無ければ null。
     */
    public Served loadFile(UUID versionId, String path) {
        PmMockupVersion v = versionMapper.selectMetaById(versionId);
        if (v == null || v.getDeletedAt() != null) {
            return null;
        }
        PmMockup m = mockupMapper.selectOneById(v.getMockupId());
        if (m == null || m.getDeletedAt() != null) {
            return null;
        }
        // 入口は大小文字を区別しない（Index.html が入口でも、版ルート / index.html で開けるように）
        if (path.equalsIgnoreCase(entryPath(v))) {
            PmMockupVersion full = versionMapper.selectOneById(versionId);
            return new Served(PmMockupBundle.contentTypeOf(PmMockupBundle.DEFAULT_ENTRY),
                full.getContent().getBytes(StandardCharsets.UTF_8));
        }
        PmMockupFile f = fileMapper.selectByPath(versionId, path);
        return f == null ? null : new Served(f.getContentType(), f.getData());
    }

    /** 署名検証済みの版 id から入口 HTML 原文を取得（旧形式 URL 用）。版・モックアップが削除済みなら null。 */
    public String loadContent(UUID versionId) {
        PmMockupVersion v = versionMapper.selectOneById(versionId);
        if (v == null || v.getDeletedAt() != null) {
            return null;
        }
        PmMockup m = mockupMapper.selectOneById(v.getMockupId());
        if (m == null || m.getDeletedAt() != null) {
            return null;
        }
        return v.getContent();
    }

    /** MCP 応答用：PM 画面でこのモックアップを開く URL。 */
    public String appUrl(PmMockupVO vo) {
        String base = signer.webBaseUrl();
        if (vo.projectId() != null) {
            return base + "/projects/" + vo.projectId() + "/mockups?open=" + vo.id();
        }
        // 案件なし（バグのみ）：品質管理の当該製品を開く（バグ詳細の「モックアップ」から見る）
        return base + "/quality/" + vo.customerId();
    }

    /** MCP 応答用：共有 URL（有効時のみ）。 */
    public String shareUrl(PmMockupVO vo) {
        if (vo.share() == null || !vo.share().enabled() || vo.share().token() == null) {
            return null;
        }
        return signer.webBaseUrl() + "/share/m/" + vo.share().token();
    }

    // ------------------------------------------------------------------ 内部

    private record Scope(UUID customerId, UUID projectId) {
    }

    /** 紐付け先から customer / project を導出し、可視性と整合性を検証する。 */
    private Scope resolveScope(UUID tenantId, UUID projectId, UUID taskId, UUID bugId) {
        if (projectId == null && taskId == null && bugId == null) {
            throw BizException.of(400, "紐付け先（案件 / タスク / バグ）を指定してください");
        }
        UUID pid = projectId;
        if (taskId != null) {
            PmTask t = taskService.getVisibleTask(taskId, tenantId);
            if (pid != null && !pid.equals(t.getProjectId())) {
                throw BizException.of(400, "タスクが指定の案件に属していません");
            }
            pid = t.getProjectId();
        }
        PmBug bug = null;
        if (bugId != null) {
            bug = bugService.getVisibleBug(bugId, tenantId);
            if (bug.getProjectId() != null) {
                if (pid != null && !pid.equals(bug.getProjectId())) {
                    throw BizException.of(400, "タスクとバグの案件が異なります");
                }
                pid = bug.getProjectId();
            }
        }
        if (pid != null) {
            PmProject p = projectService.getByIdAndTenant(pid, tenantId);
            if (bug != null && !bug.getCustomerId().equals(p.getCustomerId())) {
                throw BizException.of(400, "バグと案件の顧客が異なります");
            }
            return new Scope(p.getCustomerId(), pid);
        }
        return new Scope(bug.getCustomerId(), null);
    }

    /** 本租户・未削除・団队可視のモックアップを取得。 */
    private PmMockup getVisible(UUID id, UUID tenantId) {
        PmMockup m = mockupMapper.selectOneById(id);
        if (m == null || !tenantId.equals(m.getTenantId()) || m.getDeletedAt() != null) {
            throw BizException.of(404, "モックアップが存在しません");
        }
        if (m.getProjectId() != null) {
            projectService.getByIdAndTenant(m.getProjectId(), tenantId);
        } else {
            customerService.getByIdAndTenant(m.getCustomerId(), tenantId);
        }
        return m;
    }

    /**
     * 全列更新（null も書く：期限・固定版・紐付けを外す操作があるため）。
     * UpdateChain ではなく同じ Mapper を通すこと：同一トランザクション内の直後の get() が
     * MyBatis のセッションキャッシュから更新前の行を返してしまう。
     */
    private void save(PmMockup m) {
        mockupMapper.update(m, false);
    }

    private PmMockupVersion latestVersion(UUID mockupId) {
        List<PmMockupVersion> vs = versionMapper.selectMetaByMockup(mockupId);
        return vs.isEmpty() ? null : vs.get(0);
    }

    private PmMockupVersion findVersion(UUID mockupId, Integer version) {
        if (version == null) {
            return null;
        }
        return versionMapper.selectMetaByMockup(mockupId).stream()
            .filter(v -> v.getVersion().equals(version)).findFirst().orElse(null);
    }

    private PmMockupVO.ViewUrl signedUrl(PmMockupVersion v) {
        Instant exp = Instant.now().plusSeconds(VIEW_URL_TTL_SECONDS);
        return new PmMockupVO.ViewUrl(signer.sign(v.getId(), exp, entryPath(v)),
            LocalDateTime.ofInstant(exp, ZoneId.systemDefault()));
    }

    private static String entryPath(PmMockupVersion v) {
        return v.getEntryPath() == null ? PmMockupBundle.DEFAULT_ENTRY : v.getEntryPath();
    }

    private static int fileCount(PmMockupVersion v) {
        return v.getFileCount() == null ? 1 : v.getFileCount();
    }

    private static boolean isExpired(PmMockup m) {
        return m.getShareExpiresAt() != null && m.getShareExpiresAt().isBefore(LocalDateTime.now());
    }

    private List<PmMockupVO> toVOs(List<PmMockup> mockups, boolean withVersions) {
        if (mockups.isEmpty()) {
            return List.of();
        }
        Map<UUID, List<PmMockupVersion>> versionsByMockup = versionMapper
            .selectMetaByMockups(mockups.stream().map(PmMockup::getId).toList()).stream()
            .collect(Collectors.groupingBy(PmMockupVersion::getMockupId, LinkedHashMap::new, Collectors.toList()));
        Map<UUID, PmProject> projects = byId(projectMapper::selectListByIds,
            mockups.stream().map(PmMockup::getProjectId).toList(), PmProject::getId);
        Map<UUID, PmTask> tasks = byId(taskMapper::selectListByIds,
            mockups.stream().map(PmMockup::getTaskId).toList(), PmTask::getId);
        Map<UUID, PmBug> bugs = byId(bugMapper::selectListByIds,
            mockups.stream().map(PmMockup::getBugId).toList(), PmBug::getId);

        List<PmMockupVO> out = new ArrayList<>(mockups.size());
        for (PmMockup m : mockups) {
            List<PmMockupVersion> vs = versionsByMockup.getOrDefault(m.getId(), List.of());
            PmMockupVersion cur = vs.stream().filter(v -> v.getVersion().equals(m.getCurrentVersion()))
                .findFirst().orElse(vs.isEmpty() ? null : vs.get(0));
            PmProject p = live(projects.get(m.getProjectId()), PmProject::getDeletedAt);
            PmTask t = live(tasks.get(m.getTaskId()), PmTask::getDeletedAt);
            PmBug b = live(bugs.get(m.getBugId()), PmBug::getDeletedAt);
            out.add(new PmMockupVO(
                m.getId(), m.getCustomerId(),
                m.getProjectId(), p == null ? null : p.getName(),
                t == null ? null : t.getId(), t == null ? null : t.getName(),
                b == null ? null : b.getId(), b == null ? null : b.getBugNo(), b == null ? null : b.getTitle(),
                m.getTitle(), m.getCurrentVersion(),
                cur == null ? null : cur.getSizeBytes(),
                cur == null ? null : fileCount(cur),
                cur == null ? m.getUpdatedAt() : cur.getCreatedAt(),
                cur == null ? null : cur.getCreatedByName(),
                cur == null ? null : cur.getVia(),
                m.getCreatedBy(), m.getCreatedByName(), m.getCreatedAt(),
                new PmMockupVO.Share(Boolean.TRUE.equals(m.getShareEnabled()) && !isExpired(m), m.getShareToken(),
                    m.getShareExpiresAt(), m.getSharePinnedVersion(),
                    m.getShareViewCount() == null ? 0 : m.getShareViewCount(), m.getShareLastViewedAt()),
                withVersions ? vs.stream().map(v -> new PmMockupVO.Version(v.getVersion(), v.getNote(),
                    v.getSizeBytes(), fileCount(v), v.getVia(), v.getCreatedByName(), v.getCreatedAt())).toList() : null));
        }
        return out;
    }

    private static <T> Map<UUID, T> byId(Function<Collection<UUID>, List<T>> loader, List<UUID> ids,
                                         Function<T, UUID> idOf) {
        // HashMap：呼び出し側は null キーで get する（Map.of() は get(null) で NPE）
        Map<UUID, T> map = new HashMap<>();
        List<UUID> distinct = ids.stream().filter(Objects::nonNull).distinct().toList();
        if (distinct.isEmpty()) {
            return map;
        }
        for (T row : loader.apply(distinct)) {
            map.put(idOf.apply(row), row);
        }
        return map;
    }

    private static <T> T live(T row, Function<T, LocalDateTime> deletedAt) {
        return row == null || deletedAt.apply(row) != null ? null : row;
    }

    /** HTML の &lt;title&gt; を取り出す（基本的な実体参照のみ戻す）。 */
    static String extractHtmlTitle(String html) {
        Matcher mt = HTML_TITLE.matcher(html);
        if (!mt.find()) {
            return null;
        }
        String t = mt.group(1).replaceAll("\\s+", " ")
            .replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            .replace("&quot;", "\"").replace("&#39;", "'");
        return normalizeTitle(t);
    }

    private static String normalizeTitle(String title) {
        if (title == null) {
            return null;
        }
        String t = title.trim();
        if (t.isEmpty()) {
            return null;
        }
        return truncate(t, MAX_TITLE);
    }

    private static String truncate(String s, int max) {
        if (s == null) {
            return null;
        }
        String t = s.trim();
        if (t.isEmpty()) {
            return null;
        }
        return t.length() > max ? t.substring(0, max) : t;
    }

    /** 公開者表示名：PM メンバー名 → 租户ユーザ display_name → 「—」（PmDocService と同じ）。 */
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
}

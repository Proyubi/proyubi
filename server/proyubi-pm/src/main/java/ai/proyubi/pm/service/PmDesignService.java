package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmDesign;
import ai.proyubi.pm.domain.PmDesignComment;
import ai.proyubi.pm.domain.PmDesignRevision;
import ai.proyubi.pm.domain.PmMember;
import ai.proyubi.pm.domain.PmProject;
import ai.proyubi.pm.domain.PmTask;
import ai.proyubi.pm.mapper.PmDesignCommentMapper;
import ai.proyubi.pm.mapper.PmDesignMapper;
import ai.proyubi.pm.mapper.PmDesignRevisionMapper;
import ai.proyubi.pm.mapper.PmProjectMapper;
import ai.proyubi.pm.mapper.PmTaskMapper;
import ai.proyubi.pm.mapper.PmTenantUserMapper;
import ai.proyubi.pm.vo.PmDesignCommentVO;
import ai.proyubi.pm.vo.PmDesignVO;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;

/**
 * 設計資産Service（PM Design Studio）。Excalidraw 白板 / .pen 原稿を案件に紐付け、不可変修訂と審査コメントを持つ。
 * 設計：work/design-studio/requirements.md
 * <ul>
 *   <li>可視性：所属案件の団队可視（{@link PmProjectService#getByIdAndTenant}）。見えない = 404。
 *       編集は案件が見えるメンバー全員（既存 PM と同じ共有編集）。</li>
 *   <li>書き込みは必ず userId 必須（MCP の租户 API キーだけでは書けない）。</li>
 *   <li>保存は expectedRevision 必須。current_revision の前進は DB の CAS（更新件数 0 → 409）で判定し、
 *       修訂の INSERT と同じトランザクションで行う。旧修訂は書き換えない。</li>
 *   <li>コメントの編集・削除は投稿者本人のみ（403）。解決 / 未解決の切替は案件が見えるメンバー全員。</li>
 * </ul>
 *
 */
@Service
public class PmDesignService {

    private static final int MAX_TITLE = 200;
    private static final int MAX_NOTE = 500;
    private static final int MAX_COMMENT = 4000;
    private static final int MAX_FILE_NAME = 255;
    private static final int MAX_ELEMENT_ID = 200;
    private static final int MAX_SOURCE_FIELD = 500;
    private static final String DEFAULT_TITLE = "無題のデザイン";
    /** Git 相対パス：先頭 / 禁止、.. セグメント禁止、制御文字禁止 */
    private static final Pattern UNSAFE_PATH = Pattern.compile("(^/)|(^|/)\\.\\.(/|$)|\\\\|[\\x00-\\x1f]");
    /** URL に認証情報（user:pass@ / token@）が含まれていないこと */
    private static final Pattern CREDENTIAL_URL = Pattern.compile("^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*@");

    private final PmDesignMapper designMapper;
    private final PmDesignRevisionMapper revisionMapper;
    private final PmDesignCommentMapper commentMapper;
    private final PmProjectMapper projectMapper;
    private final PmTaskMapper taskMapper;
    private final PmProjectService projectService;
    private final PmTaskService taskService;
    private final PmMemberResolver memberResolver;
    private final PmTenantUserMapper tenantUserMapper;
    private final PmDesignContent.Limits limits;
    /** .pen は原文バイトの上限だけを使う（実際の .pen は 10MiB を超えることがある） */
    private final PmDesignContent.Limits penLimits;
    private final PmDesignFrameSyncer frameSyncer;

    public PmDesignService(PmDesignMapper designMapper, PmDesignRevisionMapper revisionMapper,
                           PmDesignCommentMapper commentMapper, PmProjectMapper projectMapper,
                           PmTaskMapper taskMapper, PmProjectService projectService, PmTaskService taskService,
                           PmMemberResolver memberResolver, PmTenantUserMapper tenantUserMapper,
                           PmDesignFrameSyncer frameSyncer,
                           @Value("${proyubi.pm.design.max-bytes:10485760}") int maxBytes,
                           @Value("${proyubi.pm.design.max-elements:5000}") int maxElements,
                           @Value("${proyubi.pm.design.max-image-bytes:5242880}") int maxImageBytes,
                           @Value("${proyubi.pm.design.max-pen-bytes:33554432}") int maxPenBytes) {
        this.designMapper = designMapper;
        this.revisionMapper = revisionMapper;
        this.commentMapper = commentMapper;
        this.projectMapper = projectMapper;
        this.taskMapper = taskMapper;
        this.projectService = projectService;
        this.taskService = taskService;
        this.memberResolver = memberResolver;
        this.tenantUserMapper = tenantUserMapper;
        this.limits = new PmDesignContent.Limits(maxBytes, maxElements, maxImageBytes);
        this.penLimits = new PmDesignContent.Limits(maxPenBytes, maxElements, maxImageBytes);
        this.frameSyncer = frameSyncer;
    }

    /** Git 由来メタ（手動導入 / 書き出し）。repo は認証情報なしの URL / 識別子、path はリポジトリ内相対パス */
    public record SourceInput(String repo, String ref, String path, String commitSha) {
    }

    /** 新規。excalidraw は content（場面 JSON、省略可＝空白板）、pen は contentBase64（原文） */
    public record CreateInput(UUID projectId, UUID taskId, String title, String format, String content,
                              String contentBase64, String fileName, String note, SourceInput source) {
    }

    /**
     * 新修訂の保存。expectedRevision 必須（読んだ時点の currentRevision）。
     * baseSourceHash：Git から取り込む場合、前回取り込み / 書き出し時の源ハッシュ。記録と違えば 409。
     */
    public record SaveInput(Integer expectedRevision, String content, String contentBase64, String fileName,
                            String note, SourceInput source, String baseSourceHash) {
    }

    // ------------------------------------------------------------------ 查询

    /** 案件 or タスクで一覧（taskId 優先）。content なし。 */
    public List<PmDesignVO> list(UUID tenantId, UUID projectId, UUID taskId) {
        if (taskId != null) {
            taskService.getVisibleTask(taskId, tenantId);
        } else if (projectId != null) {
            projectService.getByIdAndTenant(projectId, tenantId);
        } else {
            throw BizException.of(400, "projectId または taskId を指定してください");
        }
        return toVOs(tenantId, designMapper.selectLive(tenantId, projectId, taskId));
    }

    /** 詳細：指定修訂（null = 最新）の原文と全修訂メタ。 */
    public PmDesignVO get(UUID id, UUID tenantId, Integer revision) {
        return get(id, tenantId, revision, true);
    }

    /**
     * 詳細。withContent = false は原文を返さない（.pen は数十 MB になりうるので、
     * 画面はメタだけ取り、原文は {@code /source} のバイナリで取る）。
     */
    public PmDesignVO get(UUID id, UUID tenantId, Integer revision, boolean withContent) {
        PmDesign d = getVisible(id, tenantId);
        int rev = revision != null ? revision : d.getCurrentRevision();
        PmDesignRevision r = withContent
            ? revisionMapper.selectOne(tenantId, id, rev)
            : revisionMapper.selectMetaByDesigns(tenantId, List.of(id)).stream()
                .filter(x -> x.getRevision() == rev).findFirst().orElse(null);
        if (r == null) {
            throw BizException.of(404, "修訂が存在しません");
        }
        return detail(tenantId, d, r);
    }

    // ------------------------------------------------------------------ 作成 / 保存

    @Transactional
    public PmDesignVO create(UUID tenantId, UUID userId, CreateInput in, String via) {
        requireActor(tenantId, userId);
        if (in.projectId() == null) {
            throw BizException.of(400, "案件を指定してください");
        }
        String format = normalizeFormat(in.format());
        PmProject project = projectService.getByIdAndTenant(in.projectId(), tenantId);
        if (in.taskId() != null) {
            requireTaskOfProject(in.taskId(), tenantId, project.getId());
        }
        PmDesignContent.Normalized n = normalizeContent(format, in.content(), in.contentBase64(), true);
        List<PmDesignContent.PenFrame> frames = penFrames(format, n);
        SourceInput src = normalizeSource(in.source());
        String fileName = truncate(in.fileName(), MAX_FILE_NAME);
        String userName = resolveUserName(tenantId, userId);
        LocalDateTime now = LocalDateTime.now();

        PmDesign d = new PmDesign();
        d.setId(UUID.randomUUID());
        d.setTenantId(tenantId);
        d.setProjectId(project.getId());
        d.setTaskId(in.taskId());
        String title = truncate(in.title(), MAX_TITLE);
        d.setTitle(title != null ? title : fileName != null ? fileName : DEFAULT_TITLE);
        d.setFormat(format);
        d.setCurrentRevision(1);
        if (src != null) {
            d.setSourceRepo(src.repo());
            d.setSourceRef(src.ref());
            d.setSourcePath(src.path());
            d.setSourceCommitSha(src.commitSha());
            d.setSourceHash(n.sha256());
        }
        d.setCreatedBy(userId);
        d.setCreatedByName(userName);
        d.setUpdatedBy(userId);
        d.setUpdatedByName(userName);
        d.setCreatedAt(now);
        d.setUpdatedAt(now);
        designMapper.insert(d);
        PmDesignRevision r = insertRevision(tenantId, d.getId(), 1, n, fileName, in.note(), via, userId, userName, now);
        if (frames != null) {
            frameSyncer.sync(tenantId, d.getId(), 1, frames);
        }
        return detail(tenantId, d, r);
    }

    /**
     * 新修訂の保存。DB の CAS で current_revision を expected → expected+1 に進めてから修訂を INSERT する
     * （同一トランザクション。CAS 0 件 = 409 で何も書かない）。最新と完全同一の内容なら新修訂を作らない。
     */
    @Transactional
    public PmDesignVO save(UUID id, UUID tenantId, UUID userId, SaveInput in, String via) {
        requireActor(tenantId, userId);
        if (in.expectedRevision() == null) {
            throw BizException.of(400, "expectedRevision（読み込んだ修訂番号）を指定してください");
        }
        PmDesign d = getVisible(id, tenantId);
        int expected = in.expectedRevision();
        if (expected != d.getCurrentRevision()) {
            throw conflict(d.getCurrentRevision());
        }
        PmDesignContent.Normalized n = normalizeContent(d.getFormat(), in.content(), in.contentBase64(), false);
        List<PmDesignContent.PenFrame> frames = penFrames(d.getFormat(), n);
        SourceInput src = normalizeSource(in.source());
        if (in.baseSourceHash() != null && d.getSourceHash() != null && !in.baseSourceHash().equals(d.getSourceHash())) {
            throw BizException.of(409, "Git 側のファイルが前回の取り込み以降に別の内容で更新されています。"
                + "最新の書き出しと突き合わせてから取り込み直してください");
        }

        PmDesignRevision latest = revisionMapper.selectOne(tenantId, id, expected);
        if (latest != null && n.sha256().equals(latest.getSha256()) && src == null) {
            return detail(tenantId, d, latest); // 同一内容：新修訂を作らない
        }

        String userName = resolveUserName(tenantId, userId);
        int next = expected + 1;
        int updated = designMapper.advanceRevision(tenantId, id, expected, next, userId, userName,
            src == null ? null : src.repo(), src == null ? null : src.ref(),
            src == null ? null : src.path(), src == null ? null : src.commitSha(),
            src == null ? null : n.sha256());
        if (updated == 0) {
            PmDesign now = designMapper.selectOneById(id);
            throw conflict(now == null ? null : now.getCurrentRevision());
        }
        LocalDateTime now = LocalDateTime.now();
        PmDesignRevision r = insertRevision(tenantId, id, next, n, truncate(in.fileName(), MAX_FILE_NAME),
            in.note(), via, userId, userName, now);
        if (frames != null) {
            frameSyncer.sync(tenantId, id, next, frames);
        }

        d.setCurrentRevision(next);
        d.setUpdatedBy(userId);
        d.setUpdatedByName(userName);
        d.setUpdatedAt(now);
        if (src != null) {
            d.setSourceRepo(src.repo() != null ? src.repo() : d.getSourceRepo());
            d.setSourceRef(src.ref() != null ? src.ref() : d.getSourceRef());
            d.setSourcePath(src.path() != null ? src.path() : d.getSourcePath());
            d.setSourceCommitSha(src.commitSha() != null ? src.commitSha() : d.getSourceCommitSha());
            d.setSourceHash(n.sha256());
        }
        return detail(tenantId, d, r);
    }

    /** メタ編集：タイトル（null = 変更なし）、タスク紐付け（clearTask で解除）。案件の付け替えはしない。 */
    @Transactional
    public PmDesignVO updateMeta(UUID id, UUID tenantId, UUID userId, String title, UUID taskId, boolean clearTask) {
        requireActor(tenantId, userId);
        PmDesign d = getVisible(id, tenantId);
        if (!clearTask && taskId != null) {
            requireTaskOfProject(taskId, tenantId, d.getProjectId());
        }
        int updated = designMapper.updateMetaFields(tenantId, id, truncate(title, MAX_TITLE),
            clearTask || taskId != null, clearTask ? null : taskId, userId, resolveUserName(tenantId, userId));
        if (updated == 0) {
            throw BizException.of(404, "デザインが存在しません");
        }
        return toVOs(tenantId, List.of(getVisible(id, tenantId))).get(0);
    }

    /** 軟削除（修訂・コメントは残す）。 */
    @Transactional
    public void delete(UUID id, UUID tenantId, UUID userId) {
        requireActor(tenantId, userId);
        getVisible(id, tenantId);
        if (designMapper.softDelete(tenantId, id) == 0) {
            throw BizException.of(404, "デザインが存在しません");
        }
    }

    // ------------------------------------------------------------------ 审查评论

    public List<PmDesignCommentVO> listComments(UUID id, UUID tenantId, UUID userId, Integer revision) {
        getVisible(id, tenantId);
        return commentMapper.selectLive(tenantId, id, revision).stream().map(c -> toVO(c, userId)).toList();
    }

    @Transactional
    public PmDesignCommentVO addComment(UUID id, UUID tenantId, UUID userId, Integer revision, String elementId,
                                        String body, String via) {
        requireActor(tenantId, userId);
        PmDesign d = getVisible(id, tenantId);
        int rev = revision != null ? revision : d.getCurrentRevision();
        if (rev < 1 || rev > d.getCurrentRevision()) {
            throw BizException.of(400, "対象の修訂が存在しません");
        }
        String text = commentBody(body);
        String element = truncate(elementId, MAX_ELEMENT_ID);
        LocalDateTime now = LocalDateTime.now();
        PmDesignComment c = new PmDesignComment();
        c.setId(UUID.randomUUID());
        c.setTenantId(tenantId);
        c.setDesignId(id);
        c.setRevision(rev);
        c.setElementId(element);
        c.setBody(text);
        c.setResolved(false);
        c.setAuthorUserId(userId);
        c.setAuthorName(resolveUserName(tenantId, userId));
        c.setVia(normalizeVia(via));
        c.setCreatedAt(now);
        c.setUpdatedAt(now);
        commentMapper.insert(c);
        return toVO(c, userId);
    }

    @Transactional
    public PmDesignCommentVO editComment(UUID commentId, UUID tenantId, UUID userId, String body) {
        requireActor(tenantId, userId);
        PmDesignComment c = getVisibleComment(commentId, tenantId);
        requireAuthor(c, userId);
        if (commentMapper.editBody(tenantId, commentId, userId, commentBody(body)) == 0) {
            throw BizException.of(404, "コメントが存在しません");
        }
        return toVO(getVisibleComment(commentId, tenantId), userId);
    }

    @Transactional
    public PmDesignCommentVO resolveComment(UUID commentId, UUID tenantId, UUID userId, boolean resolved) {
        requireActor(tenantId, userId);
        PmDesignComment c = getVisibleComment(commentId, tenantId);
        LocalDateTime now = LocalDateTime.now();
        if (commentMapper.setResolved(tenantId, commentId, resolved, resolved ? userId : null,
            resolved ? resolveUserName(tenantId, userId) : null, resolved ? now : null) == 0) {
            throw BizException.of(404, "コメントが存在しません");
        }
        return toVO(getVisibleComment(commentId, tenantId), userId);
    }

    @Transactional
    public void deleteComment(UUID commentId, UUID tenantId, UUID userId) {
        requireActor(tenantId, userId);
        PmDesignComment c = getVisibleComment(commentId, tenantId);
        requireAuthor(c, userId);
        if (commentMapper.softDelete(tenantId, commentId, userId) == 0) {
            throw BizException.of(404, "コメントが存在しません");
        }
    }

    /** .pen 原文（指定修訂、null = 最新）。ダウンロードと OpenPencil ビューア用。 */
    public PenSource penSource(UUID id, UUID tenantId, Integer revision) {
        PmDesign d = getVisible(id, tenantId);
        if (!PmDesignContent.FORMAT_PEN.equals(d.getFormat())) {
            throw BizException.of(400, ".pen 以外の設計には原文ファイルがありません");
        }
        int rev = revision != null ? revision : d.getCurrentRevision();
        PmDesignRevision r = revisionMapper.selectOne(tenantId, id, rev);
        if (r == null) {
            throw BizException.of(404, "修訂が存在しません");
        }
        String name = r.getFileName() != null ? r.getFileName() : d.getTitle() + ".pen";
        return new PenSource(name, java.util.Base64.getDecoder().decode(r.getContent()), r.getSha256(), rev);
    }

    public record PenSource(String fileName, byte[] bytes, String sha256, int revision) {
    }

    /** 他の設計系 Service 用：可視性検証込みで設計を取る（見えなければ 404）。 */
    public PmDesign requireVisible(UUID id, UUID tenantId) {
        return getVisible(id, tenantId);
    }

    /** 他の設計系 Service 用：操作者の表示名スナップショット。 */
    public String userName(UUID tenantId, UUID userId) {
        return resolveUserName(tenantId, userId);
    }

    // ------------------------------------------------------------------ 内部

    /** .pen の画框（保存前に原文から読む。JSON として読めなければここで 400、何も書かない）。白板は null。 */
    private static List<PmDesignContent.PenFrame> penFrames(String format, PmDesignContent.Normalized n) {
        if (!PmDesignContent.FORMAT_PEN.equals(format)) {
            return null;
        }
        return PmDesignContent.penFrames(java.util.Base64.getDecoder().decode(n.content()));
    }

    /** 本租户・未削除・所属案件が団队可視の設計。どれか外れたら 404（存在を漏らさない）。 */
    private PmDesign getVisible(UUID id, UUID tenantId) {
        PmDesign d = id == null ? null : designMapper.selectOneById(id);
        if (d == null || !tenantId.equals(d.getTenantId()) || d.getDeletedAt() != null) {
            throw BizException.of(404, "デザインが存在しません");
        }
        projectService.getByIdAndTenant(d.getProjectId(), tenantId);
        return d;
    }

    private PmDesignComment getVisibleComment(UUID commentId, UUID tenantId) {
        PmDesignComment c = commentId == null ? null : commentMapper.selectOneById(commentId);
        if (c == null || !tenantId.equals(c.getTenantId()) || c.getDeletedAt() != null) {
            throw BizException.of(404, "コメントが存在しません");
        }
        getVisible(c.getDesignId(), tenantId);
        return c;
    }

    private void requireTaskOfProject(UUID taskId, UUID tenantId, UUID projectId) {
        PmTask t = taskService.getVisibleTask(taskId, tenantId);
        if (!projectId.equals(t.getProjectId())) {
            throw BizException.of(400, "同じ案件のタスクにのみ紐付けできます");
        }
    }

    /** 内部 API も有効な本租户 PM ユーザーに限定する。UUID の形式だけでは身元を検証できない。 */
    public void requireActor(UUID tenantId, UUID userId) {
        if (userId == null) {
            throw BizException.of(401, "操作者が特定できません（ユーザー情報なし）");
        }
        boolean active = tenantUserMapper.listPmMembersByTenant(tenantId).stream()
            .anyMatch(u -> userId.equals(u.getId()) && Boolean.TRUE.equals(u.getEnabled()));
        if (!active) {
            throw BizException.of(403, "この租户の有効な PM ユーザーではありません");
        }
    }

    private static void requireAuthor(PmDesignComment c, UUID userId) {
        if (!userId.equals(c.getAuthorUserId())) {
            throw BizException.of(403, "自分のコメントのみ編集・削除できます");
        }
    }

    private static BizException conflict(Integer current) {
        return BizException.of(409, "他の人が先に保存しました（最新の修訂 " + (current == null ? "?" : current)
            + "）。最新版を読み込み直してから保存してください");
    }

    private static String normalizeFormat(String format) {
        if (PmDesignContent.FORMAT_EXCALIDRAW.equals(format) || PmDesignContent.FORMAT_PEN.equals(format)) {
            return format;
        }
        throw BizException.of(400, "format は excalidraw または pen を指定してください");
    }

    private PmDesignContent.Normalized normalizeContent(String format, String content, String contentBase64,
                                                        boolean creating) {
        if (PmDesignContent.FORMAT_PEN.equals(format)) {
            if (content != null) {
                throw BizException.of(400, ".pen は contentBase64（原文バイト）で送ってください");
            }
            return PmDesignContent.normalizePen(contentBase64, penLimits);
        }
        if (contentBase64 != null) {
            throw BizException.of(400, "白板は content（場面 JSON）で送ってください");
        }
        if (content == null && creating) {
            return PmDesignContent.normalizeExcalidraw(PmDesignContent.emptyScene(), limits);
        }
        return PmDesignContent.normalizeExcalidraw(content, limits);
    }

    /** Git 由来メタの検証：相対パスのみ・.. 禁止・URL に認証情報を含めない。全部空なら null。 */
    static SourceInput normalizeSource(SourceInput s) {
        if (s == null) {
            return null;
        }
        String repo = truncate(s.repo(), MAX_SOURCE_FIELD);
        String ref = truncate(s.ref(), MAX_SOURCE_FIELD);
        String path = truncate(s.path(), MAX_SOURCE_FIELD);
        String sha = truncate(s.commitSha(), 64);
        if (repo == null && ref == null && path == null && sha == null) {
            return null;
        }
        if (repo != null && CREDENTIAL_URL.matcher(repo).find()) {
            throw BizException.of(400, "リポジトリ URL に認証情報を含めないでください");
        }
        if (path != null && UNSAFE_PATH.matcher(path).find()) {
            throw BizException.of(400, "パスはリポジトリ内の相対パスで指定してください（..・先頭 / は使えません）");
        }
        if (sha != null && !sha.matches("[0-9a-fA-F]{4,64}")) {
            throw BizException.of(400, "commitSha の形式が不正です");
        }
        return new SourceInput(repo, ref, path, sha);
    }

    private PmDesignRevision insertRevision(UUID tenantId, UUID designId, int revision, PmDesignContent.Normalized n,
                                            String fileName, String note, String via, UUID userId, String userName,
                                            LocalDateTime now) {
        PmDesignRevision r = new PmDesignRevision();
        r.setId(UUID.randomUUID());
        r.setTenantId(tenantId);
        r.setDesignId(designId);
        r.setRevision(revision);
        r.setContent(n.content());
        r.setEncoding(n.encoding());
        r.setSizeBytes(n.sizeBytes());
        r.setSha256(n.sha256());
        r.setFileName(fileName);
        r.setNote(truncate(note, MAX_NOTE));
        r.setVia(normalizeVia(via));
        r.setCreatedBy(userId);
        r.setCreatedByName(userName);
        r.setCreatedAt(now);
        revisionMapper.insert(r);
        return r;
    }

    private static String normalizeVia(String via) {
        return "mcp".equals(via) ? "mcp" : "web";
    }

    private static String commentBody(String body) {
        String t = body == null ? "" : body.strip();
        if (t.isEmpty()) {
            throw BizException.of(400, "コメントを入力してください");
        }
        if (t.length() > MAX_COMMENT) {
            throw BizException.of(400, "コメントは " + MAX_COMMENT + " 文字以内で入力してください");
        }
        return t;
    }

    private PmDesignVO detail(UUID tenantId, PmDesign d, PmDesignRevision shown) {
        PmDesignVO base = toVOs(tenantId, List.of(d)).get(0);
        List<PmDesignVO.Revision> revs = revisionMapper.selectMetaByDesigns(tenantId, List.of(d.getId())).stream()
            .map(PmDesignService::toRevision).toList();
        return new PmDesignVO(base.id(), base.projectId(), base.projectName(), base.taskId(), base.taskName(),
            base.title(), base.format(), base.currentRevision(), base.source(), base.createdBy(), base.createdByName(),
            base.createdAt(), base.updatedByName(), base.updatedAt(), toRevision(shown), shown.getContent(), revs);
    }

    private List<PmDesignVO> toVOs(UUID tenantId, List<PmDesign> designs) {
        if (designs.isEmpty()) {
            return List.of();
        }
        Map<UUID, PmProject> projects = byId(projectMapper::selectListByIds,
            designs.stream().map(PmDesign::getProjectId).toList(), PmProject::getId);
        Map<UUID, PmTask> tasks = byId(taskMapper::selectListByIds,
            designs.stream().map(PmDesign::getTaskId).toList(), PmTask::getId);
        List<PmDesignVO> out = new ArrayList<>(designs.size());
        for (PmDesign d : designs) {
            PmProject p = projects.get(d.getProjectId());
            PmTask t = tasks.get(d.getTaskId());
            boolean taskLive = t != null && t.getDeletedAt() == null && tenantId.equals(t.getTenantId());
            PmDesignVO.Source source = d.getSourcePath() == null && d.getSourceRepo() == null && d.getSourceHash() == null
                ? null
                : new PmDesignVO.Source(d.getSourceRepo(), d.getSourceRef(), d.getSourcePath(),
                d.getSourceCommitSha(), d.getSourceHash());
            out.add(new PmDesignVO(d.getId(), d.getProjectId(), p == null ? null : p.getName(),
                d.getTaskId(), taskLive ? t.getName() : null, d.getTitle(), d.getFormat(), d.getCurrentRevision(),
                source, d.getCreatedBy(), d.getCreatedByName(), d.getCreatedAt(), d.getUpdatedByName(),
                d.getUpdatedAt(), null, null, null));
        }
        return out;
    }

    private static PmDesignVO.Revision toRevision(PmDesignRevision r) {
        return new PmDesignVO.Revision(r.getRevision(), r.getEncoding(), r.getSizeBytes(), r.getSha256(),
            r.getFileName(), r.getNote(), r.getVia(), r.getCreatedByName(), r.getCreatedAt());
    }

    private static PmDesignCommentVO toVO(PmDesignComment c, UUID userId) {
        return new PmDesignCommentVO(c.getId(), c.getDesignId(), c.getRevision(), c.getElementId(),
            c.getAnchorX(), c.getAnchorY(), c.getBody(), Boolean.TRUE.equals(c.getResolved()),
            c.getResolvedByName(), c.getResolvedAt(), c.getAuthorUserId(), c.getAuthorName(), c.getVia(),
            userId != null && userId.equals(c.getAuthorUserId()), c.getCreatedAt(), c.getUpdatedAt());
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

    /** 表示名：PM メンバー名 → 租户ユーザ display_name → 「—」（PmMockupService と同じ）。 */
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

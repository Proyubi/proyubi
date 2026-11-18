package ai.proyubi.pm.service;

import ai.proyubi.common.core.exception.BizException;
import ai.proyubi.pm.domain.PmProject;

import java.util.UUID;

/**
 * サブプロジェクト（pm_project 親子）の階層ルール。DB に触れない純関数だけを置き、
 * {@link PmProjectService} から呼ぶ（単体テストで直接検証できるように分離）。
 * <ul>
 *   <li>1 階層のみ：親は parent_id=null。子を持つ案件は子になれない。自分自身は親にできない。</li>
 *   <li>親は同一テナント・削除されていないこと（呼び出し側で取得できなければ 404 相当）。</li>
 *   <li>v1：運用型（kind=ops）は親になれず、サブも ops にはできない（kind は親＝project を継承）。</li>
 *   <li>編集で親を付け替える場合は同じ顧客/製品内に限る。</li>
 *   <li>並べ替えは同じ階層内のみ（トップレベル同士 / 同じ親のサブ同士）。</li>
 * </ul>
 * メッセージは画面にそのまま出るので日本語（UI 既定言語）。
 */
public final class PmProjectHierarchyRules {

    static final String KIND_PROJECT = "project";
    static final String KIND_OPS = "ops";

    private PmProjectHierarchyRules() {
    }

    /**
     * 親候補 {@code parent} の妥当性を検証する。
     *
     * @param childId       子になる案件の ID（新規作成時は null）
     * @param childHasChildren 子になる案件が既にサブを持っているか（新規作成時は false）
     * @param childKind     子に指定された kind（null/空＝未指定）
     * @param tenantId      現在のテナント
     * @param parent        親候補（取得できなかった場合は null）
     */
    public static void validateParent(UUID childId, boolean childHasChildren, String childKind,
                                      UUID tenantId, PmProject parent) {
        if (parent == null || parent.getDeletedAt() != null
            || tenantId == null || !tenantId.equals(parent.getTenantId())) {
            throw BizException.of(404, "親プロジェクトが見つかりません");
        }
        if (childId != null && childId.equals(parent.getId())) {
            throw BizException.of(400, "自分自身を親プロジェクトにはできません");
        }
        if (parent.getParentId() != null) {
            throw BizException.of(400, "サブプロジェクトの下にはサブプロジェクトを作成できません（1 階層まで）");
        }
        if (childHasChildren) {
            throw BizException.of(400, "サブプロジェクトを持つプロジェクトは、他のプロジェクトのサブにできません");
        }
        if (KIND_OPS.equals(kindOf(parent))) {
            throw BizException.of(400, "運用・保守プロジェクトにはサブプロジェクトを作成できません");
        }
        if (KIND_OPS.equals(childKind)) {
            throw BizException.of(400, "サブプロジェクトを運用・保守にはできません");
        }
    }

    /** 編集で親を付け替える場合：同じ顧客/製品内に限る（顧客をまたぐ移動は先にトップレベルへ戻してから）。 */
    public static void validateSameCustomer(UUID childCustomerId, PmProject parent) {
        if (childCustomerId != null && !childCustomerId.equals(parent.getCustomerId())) {
            throw BizException.of(400, "親プロジェクトは同じ顧客 / 製品のプロジェクトから選んでください");
        }
    }

    /** サブを持つ親は ops に変更できない（v1 は ops の親を持たない）。 */
    public static void validateKindChangeForParent(boolean hasChildren, String newKind) {
        if (hasChildren && KIND_OPS.equals(newKind)) {
            throw BizException.of(400, "サブプロジェクトを持つプロジェクトは運用・保守にできません");
        }
    }

    /** サブ（未削除）がある親は削除できない。 */
    public static void validateDeletable(long childCount) {
        if (childCount > 0) {
            throw BizException.of(400,
                "サブプロジェクトがあるため削除できません。先にサブプロジェクトを削除または移動してください。");
        }
    }

    /**
     * 並べ替えは同じ階層内のみ：{@code expectedParentId} と同じ親（null 同士＝トップレベル同士）の案件だけを対象にする。
     */
    public static boolean sameLevel(PmProject project, UUID expectedParentId) {
        UUID p = project.getParentId();
        return expectedParentId == null ? p == null : expectedParentId.equals(p);
    }

    static String kindOf(PmProject project) {
        String kind = project.getKind();
        return kind == null || kind.isBlank() ? KIND_PROJECT : kind;
    }
}

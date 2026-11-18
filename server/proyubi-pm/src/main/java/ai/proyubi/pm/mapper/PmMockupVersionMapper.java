package ai.proyubi.pm.mapper;

import ai.proyubi.pm.domain.PmMockupVersion;
import com.mybatisflex.core.BaseMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.util.List;
import java.util.UUID;

/**
 * モックアップ版Mapper（PM）。
 * content は最大 5MB あるため、一覧・メタ情報の取得は {@link #selectMetaByMockup} を使い原文を読まない。
 *
 */
@Mapper
public interface PmMockupVersionMapper extends BaseMapper<PmMockupVersion> {

    /** content 以外の列 */
    QueryColumn[] META_COLUMNS = {
        new QueryColumn("id"), new QueryColumn("tenant_id"), new QueryColumn("mockup_id"),
        new QueryColumn("version"), new QueryColumn("size_bytes"), new QueryColumn("sha256"),
        new QueryColumn("entry_path"), new QueryColumn("file_count"),
        new QueryColumn("note"), new QueryColumn("via"), new QueryColumn("created_by"),
        new QueryColumn("created_by_name"), new QueryColumn("created_at"), new QueryColumn("deleted_at"),
    };

    /** 指定モックアップ群の未削除版（content なし）。版番号の降順。 */
    default List<PmMockupVersion> selectMetaByMockups(List<UUID> mockupIds) {
        if (mockupIds.isEmpty()) {
            return List.of();
        }
        return selectListByQuery(QueryWrapper.create()
            .select(META_COLUMNS)
            .where(PmMockupVersion::getMockupId).in(mockupIds)
            .and(PmMockupVersion::getDeletedAt).isNull()
            .orderBy(PmMockupVersion::getVersion, false));
    }

    /** 削除済みも含めた最大版番号（版番号は再利用しない：(mockup_id, version) は削除行も含めて一意）。 */
    @Select("select coalesce(max(version), 0) from pm_mockup_version where mockup_id = #{mockupId}")
    int selectMaxVersion(@Param("mockupId") UUID mockupId);

    /** 版の軟削除 */
    @Update("update pm_mockup_version set deleted_at = now() where id = #{id}")
    int softDelete(@Param("id") UUID id);

    /** 1 版のメタ情報（content なし、削除済みも返す）。付属ファイル配信時の存在確認用。 */
    default PmMockupVersion selectMetaById(UUID id) {
        return selectOneByQuery(QueryWrapper.create().select(META_COLUMNS).where(PmMockupVersion::getId).eq(id));
    }

    /** 1 モックアップの未削除版（content なし）。版番号の降順。 */
    default List<PmMockupVersion> selectMetaByMockup(UUID mockupId) {
        return selectMetaByMockups(List.of(mockupId));
    }
}

package ai.proyubi.pm.mapper;

import ai.proyubi.pm.domain.PmDesignRevision;
import com.mybatisflex.core.BaseMapper;
import com.mybatisflex.core.query.QueryColumn;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;
import java.util.UUID;

/**
 * 設計修訂Mapper。content は最大 10MiB あるため、一覧は {@link #selectMetaByDesigns} で原文を読まない。
 * 修訂は不可変：update / delete 系は使わない。
 *
 */
@Mapper
public interface PmDesignRevisionMapper extends BaseMapper<PmDesignRevision> {

    /** content 以外の列 */
    QueryColumn[] META_COLUMNS = {
        new QueryColumn("id"), new QueryColumn("tenant_id"), new QueryColumn("design_id"),
        new QueryColumn("revision"), new QueryColumn("encoding"), new QueryColumn("size_bytes"),
        new QueryColumn("sha256"), new QueryColumn("file_name"), new QueryColumn("note"),
        new QueryColumn("via"), new QueryColumn("created_by"), new QueryColumn("created_by_name"),
        new QueryColumn("created_at"),
    };

    /** 指定設計群の全修訂（content なし）。修訂番号の降順。 */
    default List<PmDesignRevision> selectMetaByDesigns(UUID tenantId, List<UUID> designIds) {
        if (designIds.isEmpty()) {
            return List.of();
        }
        return selectListByQuery(QueryWrapper.create()
            .select(META_COLUMNS)
            .where(PmDesignRevision::getTenantId).eq(tenantId)
            .and(PmDesignRevision::getDesignId).in(designIds)
            .orderBy(PmDesignRevision::getRevision, false));
    }

    /** 1 修訂（content 込み）。無ければ null。 */
    default PmDesignRevision selectOne(UUID tenantId, UUID designId, int revision) {
        return selectOneByQuery(QueryWrapper.create()
            .where(PmDesignRevision::getTenantId).eq(tenantId)
            .and(PmDesignRevision::getDesignId).eq(designId)
            .and(PmDesignRevision::getRevision).eq(revision));
    }
}

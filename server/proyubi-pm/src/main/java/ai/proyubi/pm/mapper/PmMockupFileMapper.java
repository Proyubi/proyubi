package ai.proyubi.pm.mapper;

import ai.proyubi.pm.domain.PmMockupFile;
import com.mybatisflex.core.BaseMapper;
import com.mybatisflex.core.query.QueryWrapper;
import org.apache.ibatis.annotations.Mapper;

import java.util.UUID;

/**
 * モックアップ付属ファイルMapper（PM）。
 *
 */
@Mapper
public interface PmMockupFileMapper extends BaseMapper<PmMockupFile> {

    /** 版内のパスで 1 ファイル取得（無ければ null） */
    default PmMockupFile selectByPath(UUID versionId, String path) {
        return selectOneByQuery(QueryWrapper.create()
            .where(PmMockupFile::getVersionId).eq(versionId)
            .and(PmMockupFile::getPath).eq(path));
    }
}

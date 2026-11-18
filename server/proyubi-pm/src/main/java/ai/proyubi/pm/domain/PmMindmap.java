package ai.proyubi.pm.domain;

import ai.proyubi.common.mybatisflex.typehandler.PostgreSqlJsonbTypeHandler;
import com.mybatisflex.annotation.Column;
import com.mybatisflex.annotation.Id;
import com.mybatisflex.annotation.Table;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * 思维导图实体（PM）。
 * 一张导图 = 一行 pm_mindmap，整棵节点树作为 jsonb 存于 {@code content}，
 * 形如 {"root": {id, text, note, color, collapsed, children:[...]}}。
 * 不做实时协同：保存采用 {@code version} 乐观锁，冲突由 Service 抛 409。
 *
 */
@Data
@Table("pm_mindmap")
public class PmMindmap {

    @Id
    private UUID id;

    /** 租户ID（数据隔离） */
    @Column(tenantId = false)
    private UUID tenantId;

    /** 可选关联项目（仅作归类/跳转线索；可空） */
    private UUID projectId;

    /** 导图名 */
    private String name;

    /** 主题 key（classic/dark/forest…；默认 classic） */
    private String theme;

    /** 节点树 JSON（jsonb）：{"root": MindNode}；前端整棵读写 */
    @Column(typeHandler = PostgreSqlJsonbTypeHandler.class)
    private String content;

    /** 乐观锁版本：每次成功保存 +1 */
    private Integer version;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    private LocalDateTime deletedAt;
}

package ai.proyubi.pm.vo;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 资料展示 VO。previewUrl 按 kind + externalId 计算返回，不落库。
 * 资料是共享上下文（非个人留言），不带 {@code mine}：任意本租户（团队可见）成员均可编辑/删除。
 *
 */
public record PmDocVO(
    UUID id,
    UUID customerId,
    UUID projectId,
    String projectName,
    String url,
    String provider,
    String kind,
    String externalId,
    String previewUrl,
    String title,
    /* Google Picker 登记时的 mimeType；贴 URL 登记为 null */
    String mimeType,
    /* 显式指定 JSON 名，避免 is 前缀被 Jackson 归一成 "root" */
    @JsonProperty("isRoot") boolean isRoot,
    List<TaskRef> tasks,
    UUID createdBy,
    String createdByName,
    LocalDateTime createdAt
) {
    /** 挂载的任务（id + 名称） */
    public record TaskRef(UUID taskId, String taskName) {
    }
}

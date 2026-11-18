import { request } from "@umijs/max";

/** 获取通知列表 */
export async function getNotices(params?: { page?: number; size?: number }) {
  return request<API.PageResult<API.Notice>>("/app/notices", {
    method: "GET",
    params,
  });
}

/** 获取通知详情 */
export async function getNoticeDetail(id: string) {
  return request<API.Notice>(`/app/notices/${id}`, {
    method: "GET",
  });
}

/** 标记单条已读 */
export async function markNoticeAsRead(id: string) {
  return request<void>(`/app/notices/${id}/read`, {
    method: "PUT",
  });
}

/** 批量标记已读 */
export async function batchMarkNoticesAsRead(ids: string[]) {
  return request<void>("/app/notices/batch-read", {
    method: "PUT",
    data: { ids },
  });
}

/** 标记全部已读 */
export async function markAllNoticesAsRead() {
  return request<void>("/app/notices/read-all", {
    method: "PUT",
  });
}

/** 获取未读数量 */
export async function getUnreadCount() {
  return request<API.UnreadCount>("/app/notices/unread-count", {
    method: "GET",
  });
}

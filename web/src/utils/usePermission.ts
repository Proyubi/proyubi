import { useModel } from "@umijs/max";
import { useCallback } from "react";

/**
 * 按钮级权限检查 hook
 *
 * 用法：
 *   const { hasPermission } = usePermission();
 *   hasPermission("app:product:add") → boolean
 */
export function usePermission() {
  const { initialState } = useModel("@@initialState");
  const permissions = initialState?.grantedPermissions;

  const hasPermission = useCallback(
    (code: string) => {
      if (!permissions) return false;
      return permissions.includes(code);
    },
    [permissions]
  );

  return { hasPermission };
}

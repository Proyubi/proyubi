import { useIntl } from "@umijs/max";
import { Button, Checkbox, Drawer, Modal, message, Space, Spin, Tag } from "antd";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getAssignablePermissions,
  getMemberPermissions,
  updateMemberPermissions,
} from "@/services/platform/team";

interface Props {
  open: boolean;
  memberId: string | null;
  memberName: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const PermissionModal: React.FC<Props> = ({
  open,
  memberId,
  memberName,
  onCancel,
  onSuccess,
}) => {
  const intl = useIntl();
  const [modules, setModules] = useState<API.PermissionModule[]>([]);
  const [checkedCodes, setCheckedCodes] = useState<Set<string>>(new Set());
  const [isCustom, setIsCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // All permission codes from the assignable list
  const allCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const mod of modules) {
      for (const group of mod.groups) {
        for (const perm of group.permissions) {
          codes.add(perm.code);
        }
      }
    }
    return codes;
  }, [modules]);

  const fetchData = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    try {
      const [assignable, memberPerms] = await Promise.all([
        getAssignablePermissions(),
        getMemberPermissions(memberId),
      ]);
      setModules(assignable ?? []);
      setCheckedCodes(new Set(memberPerms?.permissions ?? []));
      setIsCustom(memberPerms?.custom ?? false);
    } catch {
      // error handler
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    if (open && memberId) {
      fetchData();
    }
  }, [open, memberId, fetchData]);

  // Get the "list" permission code for a group (e.g., app:product:list)
  const getListCode = (group: API.PermissionGroup) => {
    return group.permissions.find((p) => p.action === "list")?.code;
  };

  // Toggle a single permission
  const togglePerm = (code: string, group: API.PermissionGroup) => {
    setCheckedCodes((prev) => {
      const next = new Set(prev);
      const action = code.split(":").pop();
      const listCode = getListCode(group);

      if (next.has(code)) {
        next.delete(code);
        // If unchecking "list", uncheck all in group
        if (action === "list" && listCode === code) {
          for (const p of group.permissions) {
            next.delete(p.code);
          }
        }
      } else {
        next.add(code);
        // If checking a non-list action, auto-check "list"
        if (action !== "list" && listCode) {
          next.add(listCode);
        }
      }
      return next;
    });
  };

  // Toggle all permissions in a group
  const toggleGroup = (group: API.PermissionGroup, checked: boolean) => {
    setCheckedCodes((prev) => {
      const next = new Set(prev);
      for (const p of group.permissions) {
        if (checked) {
          next.add(p.code);
        } else {
          next.delete(p.code);
        }
      }
      return next;
    });
  };

  // Check if all in group are checked
  const isGroupAllChecked = (group: API.PermissionGroup) =>
    group.permissions.every((p) => checkedCodes.has(p.code));

  const isGroupPartialChecked = (group: API.PermissionGroup) =>
    group.permissions.some((p) => checkedCodes.has(p.code)) &&
    !isGroupAllChecked(group);

  // Toggle all
  const isAllChecked = allCodes.size > 0 && [...allCodes].every((c) => checkedCodes.has(c));
  const isPartialChecked =
    [...allCodes].some((c) => checkedCodes.has(c)) && !isAllChecked;

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setCheckedCodes(new Set(allCodes));
    } else {
      setCheckedCodes(new Set());
    }
  };

  // Save
  const handleSave = async () => {
    if (!memberId) return;
    setSaving(true);
    try {
      await updateMemberPermissions(memberId, {
        permissions: [...checkedCodes].sort(),
      });
      message.success(intl.formatMessage({ id: "team.permissions.save.success" }));
      onSuccess();
    } catch {
      // error handler
    } finally {
      setSaving(false);
    }
  };

  // Reset to defaults
  const handleReset = () => {
    Modal.confirm({
      title: intl.formatMessage({ id: "team.permissions.resetDefaults.confirm" }),
      onOk: async () => {
        if (!memberId) return;
        setSaving(true);
        try {
          await updateMemberPermissions(memberId, { permissions: null });
          message.success(intl.formatMessage({ id: "team.permissions.reset.success" }));
          onSuccess();
        } catch {
          // error handler
        } finally {
          setSaving(false);
        }
      },
    });
  };

  // i18n helpers
  const groupLabel = (group: string) => {
    const key = `team.permissions.group.${group}`;
    const msg = intl.formatMessage({ id: key, defaultMessage: group });
    return msg === key ? group : msg;
  };

  const actionLabel = (action: string) => {
    const key = `team.permissions.action.${action}`;
    const msg = intl.formatMessage({ id: key, defaultMessage: action });
    return msg === key ? action : msg;
  };

  const moduleLabel = (mod: string) => {
    const key = `team.permissions.module.${mod}`;
    const msg = intl.formatMessage({ id: key, defaultMessage: mod });
    return msg === key ? mod : msg;
  };

  return (
    <Drawer
      title={intl.formatMessage(
        { id: "team.permissions.title" },
        { name: memberName }
      )}
      open={open}
      onClose={onCancel}
      width={720}
      placement="right"
      footer={
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Button onClick={handleReset} disabled={saving}>
            {intl.formatMessage({ id: "team.permissions.resetDefaults" })}
          </Button>
          <Space>
            <Button onClick={onCancel}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              {intl.formatMessage({ id: "common.confirm" })}
            </Button>
          </Space>
        </div>
      }
    >
      <Spin spinning={loading}>
        <div style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Checkbox
            checked={isAllChecked}
            indeterminate={isPartialChecked}
            onChange={(e) => toggleAll(e.target.checked)}
          >
            {intl.formatMessage({ id: "team.permissions.selectAll" })}
          </Checkbox>
          {isCustom ? (
            <Tag color="blue">
              {intl.formatMessage({ id: "team.permissions.custom" })}
            </Tag>
          ) : (
            <Tag>
              {intl.formatMessage({ id: "team.permissions.default" })}
            </Tag>
          )}
        </div>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={thStyle}>{intl.formatMessage({ id: "team.permissions.col.category" })}</th>
              <th style={thStyle}>{intl.formatMessage({ id: "team.permissions.col.target" })}</th>
              <th style={{ ...thStyle, textAlign: "left" }}>{intl.formatMessage({ id: "team.permissions.col.permissions" })}</th>
              <th style={{ ...thStyle, textAlign: "center", width: 60 }}>{intl.formatMessage({ id: "team.permissions.selectAll" })}</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((mod) =>
              mod.groups.map((group, groupIdx) => (
                <tr key={`${mod.module}-${group.group}`}>
                  {groupIdx === 0 && (
                    <td
                      rowSpan={mod.groups.length}
                      style={{
                        ...tdStyle,
                        fontWeight: 500,
                        verticalAlign: "middle",
                        background: "#fafafa",
                        width: 100,
                      }}
                    >
                      {moduleLabel(mod.module)}
                    </td>
                  )}
                  <td style={{ ...tdStyle, width: 100 }}>
                    {groupLabel(group.group)}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {group.permissions.map((perm) => (
                        <Checkbox
                          key={perm.code}
                          checked={checkedCodes.has(perm.code)}
                          onChange={() => togglePerm(perm.code, group)}
                          style={{ minWidth: 70 }}
                        >
                          {actionLabel(perm.action)}
                        </Checkbox>
                      ))}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <Checkbox
                      checked={isGroupAllChecked(group)}
                      indeterminate={isGroupPartialChecked(group)}
                      onChange={(e) => toggleGroup(group, e.target.checked)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Spin>
    </Drawer>
  );
};

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f0f0f0",
  textAlign: "left",
  fontWeight: 500,
  fontSize: 13,
  color: "rgba(0,0,0,0.65)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f0f0f0",
  verticalAlign: "middle",
};

export default PermissionModal;

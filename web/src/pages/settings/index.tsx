import {
  AppstoreOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  LogoutOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { PageContainer } from "@ant-design/pro-components";
import { history, useIntl, useModel, useSearchParams } from "@umijs/max";
import {
  Alert,
  Badge,
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import dayjs from "dayjs";
import {
  LanguageSelect,
  TeamSwitchSelect,
} from "./components/AccountQuickSettings";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  changePassword,
  requestPasswordChangeCode,
  deleteAppIcon,
  getSettings,
  uploadAppIcon,
} from "@/services/platform/settings";
import {
  deleteAccount,
  logout,
  updateProfile,
} from "@/services/platform/auth";
import {
  getTeamMembers,
  getTeamName,
  removeTeamMember,
  toggleTeamMember,
  updateTeamMember,
  updateTeamName,
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamGroupMembers,
  setTeamGroupMembers,
} from "@/services/platform/team";
import PermissionModal from "./components/PermissionModal";
import HolidaysTab from "./components/HolidaysTab";
import McpTab from "./components/McpTab";
import WorkdayTab from "./components/WorkdayTab";
import {
  checkInvitationEmail,
  createInvitation,
  listInvitations,
  resendInvitation,
  revokeInvitation,
} from "@/services/platform/invitation";

const { Text } = Typography;

/** App Settings tab - icon upload */
const AppSettingsTab: React.FC = () => {
  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [iconUrl, setIconUrl] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getSettings()
      .then((data) => setIconUrl(data.appIconUrl || null))
      .finally(() => setLoading(false));
  }, []);

  const handleUpload = async (file: File) => {
    // Validate dimensions: must be square and >= 512px
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = bitmap;
      bitmap.close();

      if (width !== height) {
        message.error(
          intl.formatMessage({ id: "settings.app.icon.sizeError" })
        );
        return;
      }
      if (width < 512) {
        message.error(
          intl.formatMessage({ id: "settings.app.icon.sizeError" })
        );
        return;
      }

      // Compress if > 1024px
      let uploadFile: File = file;
      if (width > 1024) {
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext("2d")!;
        const img = await createImageBitmap(file);
        ctx.drawImage(img, 0, 0, 1024, 1024);
        img.close();
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), "image/png")
        );
        uploadFile = new File([blob], file.name, { type: "image/png" });
      }

      setUploading(true);
      const url = await uploadAppIcon(uploadFile);
      setIconUrl(url);
      message.success(intl.formatMessage({ id: "settings.app.icon.success" }));
    } catch {
      // upload error handled by global error handler
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = () => {
    Modal.confirm({
      title: intl.formatMessage({ id: "settings.app.icon.deleteConfirm" }),
      icon: <ExclamationCircleOutlined />,
      okType: "danger",
      onOk: async () => {
        await deleteAppIcon();
        setIconUrl(null);
        message.success(
          intl.formatMessage({ id: "settings.app.icon.deleteSuccess" })
        );
      },
    });
  };

  return (
    <Card
      title={intl.formatMessage({ id: "settings.app.title" })}
      variant="borderless"
      style={{ boxShadow: "none" }}
      loading={loading}
    >
      <div style={{ maxWidth: 500 }}>
        <div style={{ marginBottom: 8, fontWeight: 500 }}>
          {intl.formatMessage({ id: "settings.app.icon" })}
        </div>
        <Text
          type="secondary"
          style={{ fontSize: 13, display: "block", marginBottom: 16 }}
        >
          {intl.formatMessage({ id: "settings.app.icon.desc" })}
        </Text>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 24,
          }}
        >
          {/* Icon preview */}
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 24,
              border: "1px dashed #d9d9d9",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#fafafa",
              flexShrink: 0,
            }}
          >
            {iconUrl ? (
              <img
                src={iconUrl}
                alt="App Icon"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            ) : (
              <AppstoreOutlined style={{ fontSize: 40, color: "#bfbfbf" }} />
            )}
          </div>

          {/* Actions */}
          <Space direction="vertical">
            <Upload
              accept="image/png"
              showUploadList={false}
              maxCount={1}
              beforeUpload={(file) => {
                handleUpload(file);
                return false;
              }}
            >
              <Button
                type="primary"
                loading={uploading}
                icon={<UploadOutlined />}
              >
                {intl.formatMessage({
                  id: iconUrl
                    ? "settings.app.icon.change"
                    : "settings.app.icon.upload",
                })}
              </Button>
            </Upload>
            {iconUrl && (
              <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>
                {intl.formatMessage({ id: "settings.app.icon.delete" })}
              </Button>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              {intl.formatMessage({ id: "settings.app.icon.requirement" })}
            </Text>
          </Space>
        </div>
      </div>
    </Card>
  );
};

/** Team management tab */
const TeamTab: React.FC<{ isOwner: boolean }> = ({ isOwner }) => {
  const intl = useIntl();
  const { initialState, setInitialState } = useModel("@@initialState");
  const [members, setMembers] = useState<API.TeamMember[]>([]);
  const [loading, setLoading] = useState(false);

  // --- 子团队（platform_team）管理 ---
  const [teams, setTeams] = useState<API.Team[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const multiTeam = teams.length > 1;
  const canCreateTeam = teams[0]?.canCreateMore ?? false;
  const [teamModalOpen, setTeamModalOpen] = useState(false);
  const [teamForm] = Form.useForm();
  const [teamEditing, setTeamEditing] = useState<API.Team | null>(null);
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamMembersOpen, setTeamMembersOpen] = useState(false);
  const [teamMembersTeam, setTeamMembersTeam] = useState<API.Team | null>(null);
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);
  const [teamMembersSaving, setTeamMembersSaving] = useState(false);

  // --- 团队名（租户名） ---
  const [teamName, setTeamName] = useState("");
  const [teamNameEditing, setTeamNameEditing] = useState(false);
  const [teamNameInput, setTeamNameInput] = useState("");
  const [teamNameSaving, setTeamNameSaving] = useState(false);

  const fetchTeamName = useCallback(async () => {
    try {
      const data = await getTeamName();
      setTeamName(data?.name ?? "");
    } catch {
      // silent
    }
  }, []);

  const handleSaveTeamName = async () => {
    const next = teamNameInput.trim();
    if (!next) {
      message.error(intl.formatMessage({ id: "team.name.required" }));
      return;
    }
    if (next === teamName) {
      setTeamNameEditing(false);
      return;
    }
    setTeamNameSaving(true);
    try {
      await updateTeamName(next);
      setTeamName(next);
      setTeamNameEditing(false);
      message.success(intl.formatMessage({ id: "team.name.success" }));
      // 刷新 currentUser，并同步 tenantName，让团队切换器 / 侧边栏标题即时更新
      const user = await initialState?.fetchUserInfo?.();
      setInitialState((s) => ({
        ...s,
        ...(user ? { currentUser: user } : {}),
        tenantName: next,
      }));
    } catch {
      // error handler
    } finally {
      setTeamNameSaving(false);
    }
  };
  const [pendingInvitations, setPendingInvitations] = useState<
    API.Invitation[]
  >([]);
  const [invitationLoading, setInvitationLoading] = useState(false);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(
    null
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm] = Form.useForm();
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCheck, setInviteCheck] = useState<API.Invitation | null>(null);
  const [inviteChecking, setInviteChecking] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [editLoading, setEditLoading] = useState(false);
  const [editMemberId, setEditMemberId] = useState<string | null>(null);
  const [permOpen, setPermOpen] = useState(false);
  const [permMemberId, setPermMemberId] = useState<string | null>(null);
  const [permMemberName, setPermMemberName] = useState("");

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getTeamMembers();
      setMembers(data ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInvitations = useCallback(async () => {
    if (!isOwner) {
      setPendingInvitations([]);
      return;
    }
    setInvitationLoading(true);
    try {
      const data = await listInvitations({ status: "pending" });
      setPendingInvitations(data ?? []);
    } catch {
      setPendingInvitations([]);
    } finally {
      setInvitationLoading(false);
    }
  }, [isOwner]);

  const fetchTeams = useCallback(async () => {
    setTeamsLoading(true);
    try {
      const data = await listTeams();
      setTeams(data ?? []);
    } catch {
      setTeams([]);
    } finally {
      setTeamsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
    fetchInvitations();
    fetchTeamName();
    fetchTeams();
  }, [fetchMembers, fetchInvitations, fetchTeamName, fetchTeams]);

  // 实时回显：邮箱失焦时调 check 接口
  const handleEmailBlur = async () => {
    const email = inviteForm.getFieldValue("email");
    if (!email || typeof email !== "string") {
      setInviteCheck(null);
      return;
    }
    setInviteChecking(true);
    try {
      const result = await checkInvitationEmail(email.trim());
      setInviteCheck(result ?? null);
    } catch {
      setInviteCheck(null);
    } finally {
      setInviteChecking(false);
    }
  };

  const handleInvite = async (values: any) => {
    if (inviteCheck?.alreadyMember) return;

    setInviteLoading(true);
    try {
      // 已有 pending → 重发；否则新建
      if (inviteCheck?.status === "pending" && inviteCheck.id) {
        await resendInvitation(inviteCheck.id);
        message.success(
          intl.formatMessage({ id: "team.invite.resendSuccess" })
        );
      } else {
        await createInvitation({
          email: values.email,
          displayName: values.displayName,
          message: values.message,
          teamIds: multiTeam ? values.teamIds : undefined,
        });
        message.success(intl.formatMessage({ id: "team.invite.success" }));
      }
      inviteForm.resetFields();
      setInviteCheck(null);
      setInviteOpen(false);
      fetchInvitations();
    } catch {
      // error handler 会处理
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRevokeInvitation = (id: string) => {
    Modal.confirm({
      title: intl.formatMessage({ id: "team.invite.revokeConfirm" }),
      icon: <ExclamationCircleOutlined />,
      okType: "danger",
      onOk: async () => {
        setInvitationActionId(id);
        try {
          await revokeInvitation(id);
          fetchInvitations();
        } finally {
          setInvitationActionId(null);
        }
      },
    });
  };

  const handleResendInvitation = async (id: string) => {
    setInvitationActionId(id);
    try {
      await resendInvitation(id);
      message.success(intl.formatMessage({ id: "team.invite.resendSuccess" }));
      fetchInvitations();
    } catch {
      // error handler
    } finally {
      setInvitationActionId(null);
    }
  };

  const handleEdit = async (values: any) => {
    if (!editMemberId) return;
    setEditLoading(true);
    try {
      await updateTeamMember(editMemberId, {
        displayName: values.displayName,
        role: values.role,
      });
      message.success(intl.formatMessage({ id: "team.edit.success" }));
      editForm.resetFields();
      setEditOpen(false);
      setEditMemberId(null);
      fetchMembers();
    } catch {
      // error handler
    } finally {
      setEditLoading(false);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await toggleTeamMember(id);
      fetchMembers();
    } catch {
      // error handler
    }
  };

  const handleRemove = (id: string) => {
    Modal.confirm({
      title: intl.formatMessage({ id: "team.remove.confirm" }),
      icon: <ExclamationCircleOutlined />,
      okType: "danger",
      onOk: async () => {
        await removeTeamMember(id);
        fetchMembers();
      },
    });
  };

  // ---- 子团队管理 handlers ----
  const openCreateTeam = () => {
    setTeamEditing(null);
    teamForm.resetFields();
    setTeamModalOpen(true);
  };

  const openEditTeam = (team: API.Team) => {
    setTeamEditing(team);
    teamForm.setFieldsValue({ name: team.name, color: team.color });
    setTeamModalOpen(true);
  };

  const handleSubmitTeam = async (values: any) => {
    setTeamSaving(true);
    try {
      if (teamEditing) {
        await updateTeam(teamEditing.id, {
          name: values.name,
          color: values.color,
        });
      } else {
        await createTeam({ name: values.name, color: values.color });
      }
      message.success(intl.formatMessage({ id: "common.save" }));
      setTeamModalOpen(false);
      setTeamEditing(null);
      teamForm.resetFields();
      fetchTeams();
    } catch {
      // error handler
    } finally {
      setTeamSaving(false);
    }
  };

  const handleDeleteTeam = (team: API.Team) => {
    Modal.confirm({
      title: intl.formatMessage(
        { id: "team.group.deleteConfirm" },
        { name: team.name }
      ),
      icon: <ExclamationCircleOutlined />,
      okType: "danger",
      onOk: async () => {
        await deleteTeam(team.id);
        fetchTeams();
      },
    });
  };

  const openTeamMembers = async (team: API.Team) => {
    setTeamMembersTeam(team);
    setTeamMemberIds([]);
    setTeamMembersOpen(true);
    try {
      const data = await getTeamGroupMembers(team.id);
      setTeamMemberIds((data ?? []).map((m) => m.tenantUserId));
    } catch {
      // silent
    }
  };

  const handleSubmitTeamMembers = async () => {
    if (!teamMembersTeam) return;
    setTeamMembersSaving(true);
    try {
      await setTeamGroupMembers(teamMembersTeam.id, teamMemberIds);
      message.success(intl.formatMessage({ id: "common.save" }));
      setTeamMembersOpen(false);
      setTeamMembersTeam(null);
      fetchTeams();
    } catch {
      // error handler
    } finally {
      setTeamMembersSaving(false);
    }
  };

  type TeamRow =
    | (API.TeamMember & { __kind: "member" })
    | (API.Invitation & { __kind: "invitation" });

  const tableData: TeamRow[] = [
    ...members.map((m) => ({ ...m, __kind: "member" as const })),
    ...pendingInvitations.map((i) => ({ ...i, __kind: "invitation" as const })),
  ];

  const memberColumns = [
    {
      title: intl.formatMessage({ id: "team.col.displayName" }),
      dataIndex: "displayName",
      key: "displayName",
      render: (val: string | undefined) => val || "—",
    },
    {
      title: intl.formatMessage({ id: "team.col.username" }),
      key: "username",
      render: (_: any, record: TeamRow) =>
        record.__kind === "member" ? record.username || "—" : record.email,
    },
    {
      title: intl.formatMessage({ id: "team.col.role" }),
      key: "role",
      render: (_: any, record: TeamRow) => (
        <Space size={4}>
          <Tag color={record.role === "owner" ? "gold" : "blue"}>
            {intl.formatMessage({
              id:
                record.role === "owner"
                  ? "team.role.owner"
                  : "team.role.member",
            })}
          </Tag>
          {record.__kind === "member" &&
            record.role === "member" &&
            record.hasCustomPermissions && (
              <Tag color="cyan" style={{ fontSize: 11 }}>
                {intl.formatMessage({ id: "team.permissions.custom" })}
              </Tag>
            )}
        </Space>
      ),
    },
    ...(multiTeam
      ? [
          {
            title: intl.formatMessage({ id: "team.col.teams" }),
            key: "teams",
            render: (_: any, record: TeamRow) => {
              // 邀请：显示被邀请到的团队（teamIds → 团队名）
              if (record.__kind === "invitation") {
                const names = (record.teamIds ?? [])
                  .map((tid) => teams.find((t) => t.id === tid)?.name)
                  .filter(Boolean) as string[];
                if (names.length === 0) {
                  return <Text type="secondary">—</Text>;
                }
                return (
                  <Space size={4} wrap>
                    {names.map((n) => (
                      <Tag key={n}>{n}</Tag>
                    ))}
                  </Space>
                );
              }
              // owner：不受团队限制，可见全チーム
              if (record.role === "owner") {
                return (
                  <Text type="secondary">
                    {intl.formatMessage({ id: "team.allTeams" })}
                  </Text>
                );
              }
              const memberTeams = record.teams ?? [];
              if (memberTeams.length === 0) {
                return <Text type="secondary">—</Text>;
              }
              return (
                <Space size={4} wrap>
                  {memberTeams.map((t) => (
                    <Tag key={t.id}>{t.name}</Tag>
                  ))}
                </Space>
              );
            },
          },
        ]
      : []),
    {
      title: intl.formatMessage({ id: "team.col.status" }),
      key: "status",
      render: (_: any, record: TeamRow) => {
        if (record.__kind === "invitation") {
          return (
            <Badge
              status="warning"
              text={intl.formatMessage({ id: "team.status.invited" })}
            />
          );
        }
        return (
          <Badge
            status={record.isEnabled ? "success" : "default"}
            text={intl.formatMessage({
              id: record.isEnabled
                ? "team.status.active"
                : "team.status.disabled",
            })}
          />
        );
      },
    },
    {
      title: intl.formatMessage({ id: "common.createdAt" }),
      dataIndex: "createdAt",
      key: "createdAt",
      render: (val: string) =>
        val ? dayjs(val).format("YYYY-MM-DD HH:mm") : "-",
    },
    ...(isOwner
      ? [
          {
            title: intl.formatMessage({ id: "common.action" }),
            key: "action",
            render: (_: any, record: TeamRow) => {
              if (record.__kind === "invitation") {
                return (
                  <Space size="small">
                    <Button
                      type="link"
                      size="small"
                      loading={invitationActionId === record.id}
                      onClick={() => handleResendInvitation(record.id)}
                    >
                      {intl.formatMessage({ id: "team.invite.resend" })}
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      danger
                      loading={invitationActionId === record.id}
                      onClick={() => handleRevokeInvitation(record.id)}
                    >
                      {intl.formatMessage({ id: "team.invite.revoke" })}
                    </Button>
                  </Space>
                );
              }
              return (
                <Space size="small">
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setEditMemberId(record.id);
                      editForm.setFieldsValue({
                        displayName: record.displayName,
                        role: record.role,
                      });
                      setEditOpen(true);
                    }}
                  >
                    {intl.formatMessage({ id: "team.edit" })}
                  </Button>
                  {record.role !== "owner" && (
                    <>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          setPermMemberId(record.id);
                          setPermMemberName(
                            record.displayName || record.username || ""
                          );
                          setPermOpen(true);
                        }}
                      >
                        {intl.formatMessage({ id: "team.permissions" })}
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => handleToggle(record.id)}
                      >
                        {intl.formatMessage({
                          id: record.isEnabled ? "team.disable" : "team.enable",
                        })}
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        danger
                        onClick={() => handleRemove(record.id)}
                      >
                        {intl.formatMessage({ id: "team.remove" })}
                      </Button>
                    </>
                  )}
                </Space>
              );
            },
          },
        ]
      : []),
  ];

  // 邀请按钮的 disable 状态：邮箱已是成员 → 禁用；checking 中也禁用
  const inviteSubmitDisabled =
    inviteChecking || (inviteCheck?.alreadyMember ?? false);
  // 邀请按钮的文案：已 pending → "重发"；其他 → "邀请"
  const inviteSubmitLabel =
    inviteCheck?.status === "pending"
      ? intl.formatMessage({ id: "team.invite.resend" })
      : intl.formatMessage({ id: "team.invite" });

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card
        title={intl.formatMessage({ id: "team.name.title" })}
        variant="borderless"
        style={{ boxShadow: "none" }}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
          {intl.formatMessage({ id: "team.name.desc" })}
        </Text>
        {teamNameEditing ? (
          <Space.Compact style={{ maxWidth: 400, width: "100%" }}>
            <Input
              autoFocus
              value={teamNameInput}
              maxLength={50}
              onChange={(e) => setTeamNameInput(e.target.value)}
              onPressEnter={handleSaveTeamName}
              placeholder={intl.formatMessage({ id: "team.name.placeholder" })}
            />
            <Button
              type="primary"
              loading={teamNameSaving}
              onClick={handleSaveTeamName}
            >
              {intl.formatMessage({ id: "common.save" })}
            </Button>
            <Button onClick={() => setTeamNameEditing(false)}>
              {intl.formatMessage({ id: "common.cancel" })}
            </Button>
          </Space.Compact>
        ) : (
          <Space>
            <Text strong style={{ fontSize: 16 }}>
              {teamName || "—"}
            </Text>
            {isOwner && (
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setTeamNameInput(teamName);
                  setTeamNameEditing(true);
                }}
              >
                {intl.formatMessage({ id: "team.name.edit" })}
              </Button>
            )}
          </Space>
        )}
      </Card>

      <Card
        title={intl.formatMessage({ id: "team.group.title" })}
        variant="borderless"
        style={{ boxShadow: "none" }}
        extra={
          isOwner && canCreateTeam ? (
            <Button type="primary" onClick={openCreateTeam}>
              {intl.formatMessage({ id: "team.group.create" })}
            </Button>
          ) : null
        }
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
          {intl.formatMessage({ id: "team.group.desc" })}
        </Text>
        <Table<API.Team>
          rowKey="id"
          loading={teamsLoading}
          pagination={false}
          size="middle"
          dataSource={teams}
          columns={[
            {
              title: intl.formatMessage({ id: "team.group.col.name" }),
              dataIndex: "name",
              key: "name",
              render: (val: string, row: API.Team) => (
                <Space>
                  <Text strong>{val}</Text>
                  {row.isDefault && (
                    <Tag color="blue">
                      {intl.formatMessage({ id: "team.group.default" })}
                    </Tag>
                  )}
                </Space>
              ),
            },
            {
              title: intl.formatMessage({ id: "team.group.col.members" }),
              dataIndex: "memberCount",
              key: "memberCount",
              width: 120,
            },
            ...(isOwner
              ? [
                  {
                    title: intl.formatMessage({ id: "common.action" }),
                    key: "action",
                    width: 220,
                    render: (_: unknown, row: API.Team) => (
                      <Space size="small">
                        <Button
                          type="link"
                          size="small"
                          onClick={() => openTeamMembers(row)}
                        >
                          {intl.formatMessage({ id: "team.group.members" })}
                        </Button>
                        <Button
                          type="link"
                          size="small"
                          onClick={() => openEditTeam(row)}
                        >
                          {intl.formatMessage({ id: "team.edit" })}
                        </Button>
                        {!row.isDefault && (
                          <Button
                            type="link"
                            size="small"
                            danger
                            onClick={() => handleDeleteTeam(row)}
                          >
                            {intl.formatMessage({ id: "team.remove" })}
                          </Button>
                        )}
                      </Space>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Card
        title={intl.formatMessage({ id: "team.title" })}
        variant="borderless"
        style={{ boxShadow: "none" }}
        extra={
          isOwner ? (
            <Button type="primary" onClick={() => setInviteOpen(true)}>
              {intl.formatMessage({ id: "team.invite" })}
            </Button>
          ) : null
        }
      >
        <Table<TeamRow>
          rowKey="id"
          columns={memberColumns}
          dataSource={tableData}
          loading={loading || invitationLoading}
          pagination={false}
          size="middle"
        />
      </Card>

      <Modal
        title={intl.formatMessage({ id: "team.invite.title" })}
        open={inviteOpen}
        onCancel={() => {
          setInviteOpen(false);
          inviteForm.resetFields();
          setInviteCheck(null);
        }}
        footer={null}
      >
        <Form form={inviteForm} layout="vertical" onFinish={handleInvite}>
          <Form.Item
            name="email"
            label={intl.formatMessage({ id: "team.invite.email" })}
            rules={[
              { required: true },
              {
                type: "email",
                message: intl.formatMessage({ id: "team.invite.emailInvalid" }),
              },
            ]}
          >
            <Input
              autoFocus
              onBlur={handleEmailBlur}
              placeholder="user@example.com"
            />
          </Form.Item>

          {inviteChecking && (
            <Alert
              type="info"
              showIcon
              message={intl.formatMessage({ id: "team.invite.checking" })}
              style={{ marginBottom: 16 }}
            />
          )}
          {!inviteChecking && inviteCheck?.alreadyMember && (
            <Alert
              type="warning"
              showIcon
              message={intl.formatMessage({ id: "team.invite.alreadyMember" })}
              style={{ marginBottom: 16 }}
            />
          )}
          {!inviteChecking &&
            !inviteCheck?.alreadyMember &&
            inviteCheck?.status === "pending" && (
              <Alert
                type="info"
                showIcon
                message={intl.formatMessage({
                  id: "team.invite.alreadyPending",
                })}
                style={{ marginBottom: 16 }}
              />
            )}
          {!inviteChecking &&
            !inviteCheck?.alreadyMember &&
            inviteCheck?.status !== "pending" &&
            inviteCheck?.accountExists && (
              <Alert
                type="success"
                showIcon
                message={intl.formatMessage({
                  id: "team.invite.accountExists",
                })}
                style={{ marginBottom: 16 }}
              />
            )}
          {!inviteChecking &&
            !inviteCheck?.alreadyMember &&
            inviteCheck?.status !== "pending" &&
            inviteCheck?.accountExists === false && (
              <Alert
                type="info"
                showIcon
                message={intl.formatMessage({ id: "team.invite.accountNew" })}
                style={{ marginBottom: 16 }}
              />
            )}

          <Form.Item
            name="displayName"
            label={intl.formatMessage({ id: "team.invite.displayName" })}
            tooltip={intl.formatMessage({ id: "team.invite.displayName.tip" })}
          >
            <Input />
          </Form.Item>
          {multiTeam && (
            <Form.Item
              name="teamIds"
              label={intl.formatMessage({ id: "team.invite.teams" })}
              tooltip={intl.formatMessage({ id: "team.invite.teams.tip" })}
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({
                    id: "team.invite.teamsRequired",
                  }),
                },
              ]}
            >
              <Select
                mode="multiple"
                allowClear
                options={teams.map((tm) => ({ label: tm.name, value: tm.id }))}
                placeholder={intl.formatMessage({
                  id: "team.invite.teamsPlaceholder",
                })}
              />
            </Form.Item>
          )}
          <Form.Item
            name="message"
            label={intl.formatMessage({ id: "team.invite.message" })}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                loading={inviteLoading}
                disabled={inviteSubmitDisabled}
              >
                {inviteSubmitLabel}
              </Button>
              <Button
                onClick={() => {
                  setInviteOpen(false);
                  inviteForm.resetFields();
                  setInviteCheck(null);
                }}
              >
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={
          teamEditing
            ? intl.formatMessage({ id: "team.group.editTitle" })
            : intl.formatMessage({ id: "team.group.create" })
        }
        open={teamModalOpen}
        onCancel={() => {
          setTeamModalOpen(false);
          setTeamEditing(null);
          teamForm.resetFields();
        }}
        footer={null}
      >
        <Form form={teamForm} layout="vertical" onFinish={handleSubmitTeam}>
          <Form.Item
            name="name"
            label={intl.formatMessage({ id: "team.group.col.name" })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({ id: "team.group.nameRequired" }),
              },
            ]}
          >
            <Input maxLength={50} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={teamSaving}>
                {intl.formatMessage({ id: "common.confirm" })}
              </Button>
              <Button
                onClick={() => {
                  setTeamModalOpen(false);
                  setTeamEditing(null);
                  teamForm.resetFields();
                }}
              >
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={intl.formatMessage(
          { id: "team.group.membersTitle" },
          { name: teamMembersTeam?.name ?? "" }
        )}
        open={teamMembersOpen}
        onOk={handleSubmitTeamMembers}
        confirmLoading={teamMembersSaving}
        onCancel={() => {
          setTeamMembersOpen(false);
          setTeamMembersTeam(null);
        }}
        okText={intl.formatMessage({ id: "common.save" })}
        cancelText={intl.formatMessage({ id: "common.cancel" })}
        destroyOnHidden
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          {intl.formatMessage({ id: "team.group.membersDesc" })}
        </Text>
        <Select
          mode="multiple"
          allowClear
          style={{ width: "100%" }}
          value={teamMemberIds}
          onChange={(v) => setTeamMemberIds(v)}
          placeholder={intl.formatMessage({
            id: "team.group.membersPlaceholder",
          })}
          options={members
            .filter((m) => m.isEnabled || m.role === "owner")
            .map((m) => ({
              label: m.displayName || m.username || m.id,
              value: m.id,
            }))}
        />
      </Modal>

      <Modal
        title={intl.formatMessage({ id: "team.edit" })}
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          editForm.resetFields();
          setEditMemberId(null);
        }}
        footer={null}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item
            name="displayName"
            label={intl.formatMessage({ id: "team.col.displayName" })}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="role"
            label={intl.formatMessage({ id: "team.col.role" })}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                {
                  value: "owner",
                  label: intl.formatMessage({ id: "team.role.owner" }),
                },
                {
                  value: "member",
                  label: intl.formatMessage({ id: "team.role.member" }),
                },
              ]}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={editLoading}>
                {intl.formatMessage({ id: "common.confirm" })}
              </Button>
              <Button
                onClick={() => {
                  setEditOpen(false);
                  editForm.resetFields();
                  setEditMemberId(null);
                }}
              >
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <PermissionModal
        open={permOpen}
        memberId={permMemberId}
        memberName={permMemberName}
        onCancel={() => {
          setPermOpen(false);
          setPermMemberId(null);
        }}
        onSuccess={() => {
          setPermOpen(false);
          setPermMemberId(null);
          fetchMembers();
        }}
      />
    </Space>
  );
};

const SettingsPage: React.FC = () => {
  const intl = useIntl();
  const { initialState, setInitialState } = useModel("@@initialState");
  const currentUser = initialState?.currentUser;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "account";

  const handleTabChange = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    setSearchParams(next, { replace: true });
  };

  // --- Profile (表示名) ---
  const [profileForm] = Form.useForm();
  const [profileLoading, setProfileLoading] = useState(false);
  const [displayNameEditing, setDisplayNameEditing] = useState(false);

  // currentUser 加载/变更后回填表示名（用 displayName 原始值，未设置则留空）
  useEffect(() => {
    profileForm.setFieldsValue({ displayName: currentUser?.displayName ?? "" });
  }, [currentUser?.displayName, profileForm]);

  const refreshCurrentUser = async () => {
    const user = await initialState?.fetchUserInfo?.();
    if (user) {
      setInitialState((s) => ({ ...s, currentUser: user }));
    }
  };

  const handleUpdateProfile = async (values: { displayName?: string }) => {
    setProfileLoading(true);
    try {
      await updateProfile({ displayName: values.displayName?.trim() || null });
      message.success(
        intl.formatMessage({ id: "settings.account.displayNameSuccess" })
      );
      setDisplayNameEditing(false);
      await refreshCurrentUser();
    } finally {
      setProfileLoading(false);
    }
  };

  // --- Password ---
  const PASSWORD_CODE_COOLDOWN = 60;
  const [passwordForm] = Form.useForm();
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const codeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (codeTimerRef.current) clearInterval(codeTimerRef.current);
    };
  }, []);

  const startCodeCooldown = () => {
    setCodeCooldown(PASSWORD_CODE_COOLDOWN);
    codeTimerRef.current = setInterval(() => {
      setCodeCooldown((prev) => {
        if (prev <= 1) {
          if (codeTimerRef.current) clearInterval(codeTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // メール末尾だけ見せるマスク：a***@example.com
  const maskedPasswordEmail = (() => {
    const email = currentUser?.email;
    if (!email) return "";
    const [name, domain] = email.split("@");
    if (!domain) return email;
    const head = name.slice(0, 1);
    return `${head}${"*".repeat(Math.max(name.length - 1, 1))}@${domain}`;
  })();

  const handleSendPasswordCode = async () => {
    if (codeCooldown > 0) return;
    setSendingCode(true);
    try {
      await requestPasswordChangeCode();
      startCodeCooldown();
      message.success(intl.formatMessage({ id: "settings.password.codeSent" }));
    } catch {
      // error message surfaced by global error handler
    } finally {
      setSendingCode(false);
    }
  };

  // 无密码（邮箱/OAuth 注册）账号：只影响文案（「设置密码」而非「修改密码」），
  // 接口和表单字段两边完全一致 —— 都是「邮箱验证码 + 新密码」。
  const isSetPasswordMode = currentUser?.hasPassword === false;

  const handleChangePassword = async (values: any) => {
    setPasswordLoading(true);
    try {
      await changePassword({
        newPassword: values.newPassword,
        code: values.code,
      });
      message.success(
        intl.formatMessage({
          id: isSetPasswordMode
            ? "settings.password.setSuccess"
            : "settings.password.success",
        })
      );
      passwordForm.resetFields();
      setPasswordModalOpen(false);
      // 设置成功后 hasPassword 变 true，刷新后卡片自动切到「修改密码」文案
      await refreshCurrentUser();
    } finally {
      setPasswordLoading(false);
    }
  };

  // --- Logout ---
  const [logoutLoading, setLogoutLoading] = useState(false);

  const handleLogout = () => {
    Modal.confirm({
      title: intl.formatMessage({ id: "settings.account.logoutConfirmTitle" }),
      icon: <ExclamationCircleOutlined />,
      okText: intl.formatMessage({ id: "settings.account.logout" }),
      cancelText: intl.formatMessage({ id: "common.cancel" }),
      onOk: async () => {
        setLogoutLoading(true);
        try {
          await logout();
        } catch (_) {
          // ignore
        }
        localStorage.removeItem("pullcord_token");
        setInitialState((s) => ({ ...s, currentUser: undefined }));
        history.push("/user/login");
        setLogoutLoading(false);
      },
    });
  };

  // --- Delete Account ---
  const [deleteAccountLoading, setDeleteAccountLoading] = useState(false);

  const handleDeleteAccount = () => {
    const hasPassword = currentUser?.hasPassword !== false; // 默认按"有密码"，避免老接口下误隐藏
    const userEmail = currentUser?.email;
    let inputValue = "";
    Modal.confirm({
      title: intl.formatMessage({ id: "settings.account.deleteConfirmTitle" }),
      icon: <ExclamationCircleOutlined />,
      width: 520,
      content: (
        <div style={{ marginTop: 4 }}>
          <Typography.Paragraph
            style={{
              marginBottom: 16,
              color: "rgba(0, 0, 0, 0.65)",
              lineHeight: 1.6,
            }}
          >
            {hasPassword
              ? intl.formatMessage({ id: "settings.account.deleteConfirmDesc" })
              : intl.formatMessage(
                  { id: "settings.account.deleteConfirmEmailDesc" },
                  { email: userEmail || "" }
                )}
          </Typography.Paragraph>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              <span style={{ fontWeight: 500 }}>
                {intl.formatMessage({
                  id: "settings.account.deleteDataNotice",
                })}
              </span>
            }
            description={
              <div
                style={{
                  marginTop: 8,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  rowGap: 6,
                  columnGap: 16,
                }}
              >
                {[
                  "settings.account.deleteDataItem.records",
                  "settings.account.deleteDataItem.stock",
                  "settings.account.deleteDataItem.products",
                  "settings.account.deleteDataItem.user",
                ].map((id) => (
                  <span
                    key={id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: "50%",
                        background: "rgba(0, 0, 0, 0.45)",
                        flexShrink: 0,
                      }}
                    />
                    {intl.formatMessage({ id })}
                  </span>
                ))}
              </div>
            }
          />
          {hasPassword ? (
            <Input.Password
              size="large"
              placeholder={intl.formatMessage({
                id: "settings.account.deleteConfirmPassword",
              })}
              onChange={(e) => {
                inputValue = e.target.value;
              }}
            />
          ) : (
            <Input
              size="large"
              placeholder={userEmail || ""}
              autoComplete="off"
              onChange={(e) => {
                inputValue = e.target.value;
              }}
            />
          )}
        </div>
      ),
      okText: intl.formatMessage({ id: "settings.account.deleteAccount" }),
      okType: "danger",
      cancelText: intl.formatMessage({ id: "common.cancel" }),
      onOk: async () => {
        if (!inputValue) {
          message.error(
            intl.formatMessage({
              id: hasPassword
                ? "settings.account.deleteConfirmPassword"
                : "settings.account.deleteConfirmEmailRequired",
            })
          );
          throw new Error("confirmation required");
        }
        if (!hasPassword) {
          if (
            !userEmail ||
            inputValue.trim().toLowerCase() !== userEmail.toLowerCase()
          ) {
            message.error(
              intl.formatMessage({
                id: "settings.account.deleteConfirmEmailMismatch",
              })
            );
            throw new Error("email mismatch");
          }
        }
        setDeleteAccountLoading(true);
        try {
          await deleteAccount(
            hasPassword
              ? { password: inputValue }
              : { emailConfirmation: inputValue.trim() }
          );
          message.success(
            intl.formatMessage({ id: "settings.account.deleteSuccess" })
          );
          localStorage.removeItem("pullcord_token");
          history.push("/user/login");
        } finally {
          setDeleteAccountLoading(false);
        }
      },
    });
  };

  const tabItems = [
    {
      key: "account",
      label: intl.formatMessage({ id: "settings.tab.account" }),
      children: (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Card
            title={intl.formatMessage({ id: "settings.account.info" })}
            variant="borderless"
            style={{ boxShadow: "none" }}
          >
            <Form
              form={profileForm}
              layout="horizontal"
              onFinish={handleUpdateProfile}
              labelCol={{ flex: "110px" }}
              wrapperCol={{ flex: 1 }}
              labelAlign="left"
              colon
              style={{ maxWidth: 520 }}
            >
              <Form.Item
                label={intl.formatMessage({ id: "settings.account.username" })}
              >
                <Text>{currentUser?.loginId || "-"}</Text>
              </Form.Item>
              <Form.Item
                label={intl.formatMessage({ id: "settings.account.userCode" })}
              >
                <Text>
                  {currentUser?.tenantId
                    ? currentUser.tenantId.split("-").pop()
                    : "-"}
                </Text>
              </Form.Item>
              <Form.Item
                label={intl.formatMessage({ id: "settings.account.createdAt" })}
              >
                <Text>
                  {currentUser?.createdAt
                    ? dayjs(currentUser.createdAt).format("YYYY-MM-DD HH:mm")
                    : "-"}
                </Text>
              </Form.Item>
              <Form.Item
                label={intl.formatMessage({
                  id: "settings.account.displayName",
                })}
                extra={intl.formatMessage({
                  id: "settings.account.displayNameHint",
                })}
              >
                {displayNameEditing ? (
                  <Space.Compact style={{ width: "100%" }}>
                    <Form.Item name="displayName" noStyle rules={[{ max: 50 }]}>
                      <Input
                        autoFocus
                        allowClear
                        placeholder={intl.formatMessage({
                          id: "settings.account.displayNamePlaceholder",
                        })}
                      />
                    </Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={profileLoading}
                    >
                      {intl.formatMessage({ id: "common.save" })}
                    </Button>
                    <Button
                      onClick={() => {
                        profileForm.setFieldsValue({
                          displayName: currentUser?.displayName ?? "",
                        });
                        setDisplayNameEditing(false);
                      }}
                    >
                      {intl.formatMessage({ id: "common.cancel" })}
                    </Button>
                  </Space.Compact>
                ) : (
                  <Space>
                    <Text strong>{currentUser?.displayName || "—"}</Text>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => setDisplayNameEditing(true)}
                    >
                      {intl.formatMessage({ id: "team.name.edit" })}
                    </Button>
                  </Space>
                )}
              </Form.Item>

              {(currentUser?.availableTeams?.length ?? 0) >= 2 && (
                <Form.Item
                  label={intl.formatMessage({ id: "teamSwitcher.title" })}
                >
                  <TeamSwitchSelect />
                </Form.Item>
              )}

              <Form.Item
                label={intl.formatMessage({
                  id: "navBar.lang",
                  defaultMessage: "Language",
                })}
                style={{ marginBottom: 0 }}
              >
                <LanguageSelect />
              </Form.Item>
            </Form>
          </Card>

          <Card
            title={intl.formatMessage({
              id: isSetPasswordMode
                ? "settings.password.setTitle"
                : "settings.password.title",
            })}
            variant="borderless"
            style={{ boxShadow: "none" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text type="secondary" style={{ fontSize: 13, maxWidth: 520 }}>
                {intl.formatMessage({
                  id: isSetPasswordMode
                    ? "settings.password.setHint"
                    : "settings.password.changeDesc",
                })}
              </Text>
              <Button
                onClick={() => {
                  passwordForm.resetFields();
                  setPasswordModalOpen(true);
                }}
              >
                {intl.formatMessage({
                  id: isSetPasswordMode
                    ? "settings.password.setSubmit"
                    : "settings.password.submit",
                })}
              </Button>
            </div>
          </Card>

          {
            <Modal
              title={intl.formatMessage({
                id: isSetPasswordMode
                  ? "settings.password.setTitle"
                  : "settings.password.title",
              })}
              open={passwordModalOpen}
              onCancel={() => setPasswordModalOpen(false)}
              onOk={() => passwordForm.submit()}
              confirmLoading={passwordLoading}
              okText={intl.formatMessage({
                id: isSetPasswordMode
                  ? "settings.password.setSubmit"
                  : "settings.password.submit",
              })}
              cancelText={intl.formatMessage({ id: "common.cancel" })}
              destroyOnClose
              maskClosable={false}
            >
              <Form
                form={passwordForm}
                layout="vertical"
                onFinish={handleChangePassword}
                style={{ marginTop: 16 }}
              >
                <Text
                  type="secondary"
                  style={{ display: "block", marginBottom: 16 }}
                >
                  {intl.formatMessage({
                    id: isSetPasswordMode
                      ? "settings.password.setHint"
                      : "settings.password.changeDesc",
                  })}
                </Text>
                <Form.Item
                  name="newPassword"
                  label={intl.formatMessage({ id: "settings.password.new" })}
                  rules={[
                    { required: true },
                    {
                      min: 6,
                      max: 50,
                      message: intl.formatMessage({
                        id: "settings.password.minLength",
                      }),
                    },
                  ]}
                >
                  <Input.Password />
                </Form.Item>
                <Form.Item
                  name="confirmPassword"
                  label={intl.formatMessage({
                    id: "settings.password.confirm",
                  })}
                  dependencies={["newPassword"]}
                  rules={[
                    { required: true },
                    ({ getFieldValue }) => ({
                      validator(_, value) {
                        if (!value || getFieldValue("newPassword") === value) {
                          return Promise.resolve();
                        }
                        return Promise.reject(
                          new Error(
                            intl.formatMessage({
                              id: "settings.password.mismatch",
                            })
                          )
                        );
                      },
                    }),
                  ]}
                >
                  <Input.Password />
                </Form.Item>
                <Form.Item
                  label={intl.formatMessage({ id: "settings.password.code" })}
                  extra={
                    maskedPasswordEmail
                      ? intl.formatMessage(
                          { id: "settings.password.codeSentTo" },
                          { email: maskedPasswordEmail }
                        )
                      : undefined
                  }
                  required
                >
                  <Space.Compact style={{ width: "100%" }}>
                    <Form.Item
                      name="code"
                      noStyle
                      rules={[
                        { required: true },
                        {
                          pattern: /^\d{6}$/,
                          message: intl.formatMessage({
                            id: "settings.password.codeInvalid",
                          }),
                        },
                      ]}
                    >
                      <Input
                        maxLength={6}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder={intl.formatMessage({
                          id: "settings.password.codePlaceholder",
                        })}
                      />
                    </Form.Item>
                    <Button
                      onClick={handleSendPasswordCode}
                      loading={sendingCode}
                      disabled={codeCooldown > 0}
                    >
                      {codeCooldown > 0
                        ? intl.formatMessage(
                            { id: "settings.password.codeResendIn" },
                            { seconds: codeCooldown }
                          )
                        : intl.formatMessage({
                            id: "settings.password.sendCode",
                          })}
                    </Button>
                  </Space.Compact>
                </Form.Item>
              </Form>
            </Modal>
          }

          <Card
            title={intl.formatMessage({ id: "settings.account.logout" })}
            variant="borderless"
            style={{ boxShadow: "none" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <Text strong>
                  {intl.formatMessage({ id: "settings.account.logout" })}
                </Text>
                <br />
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {intl.formatMessage({
                    id: "settings.account.logoutDesc",
                  })}
                </Text>
              </div>
              <Button
                icon={<LogoutOutlined />}
                loading={logoutLoading}
                onClick={handleLogout}
              >
                {intl.formatMessage({ id: "settings.account.logout" })}
              </Button>
            </div>
          </Card>
        </Space>
      ),
    },
    {
      key: "security",
      label: intl.formatMessage({ id: "settings.tab.security" }),
      children: (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Card
            title={
              <span style={{ color: "#ff4d4f" }}>
                {intl.formatMessage({ id: "settings.account.dangerZone" })}
              </span>
            }
            variant="borderless"
            style={{
              boxShadow: "none",
              borderTop: "2px solid #ff4d4f",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <Text strong>
                  {intl.formatMessage({ id: "settings.account.deleteAccount" })}
                </Text>
                <br />
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {intl.formatMessage({
                    id: "settings.account.deleteAccountDesc",
                  })}
                </Text>
              </div>
              <Button
                danger
                loading={deleteAccountLoading}
                onClick={handleDeleteAccount}
              >
                {intl.formatMessage({ id: "settings.account.deleteAccount" })}
              </Button>
            </div>
          </Card>
        </Space>
      ),
    },
    // App settings tab hidden — feature retained for future use:
    // { key: "app", label: intl.formatMessage({ id: "settings.tab.app" }), children: <AppSettingsTab /> },
    ...(initialState?.grantedPermissions?.includes("app:team:list")
      ? [
          {
            key: "team",
            label: intl.formatMessage({ id: "settings.tab.team" }),
            children: <TeamTab isOwner={currentUser?.role === "owner"} />,
          },
        ]
      : []),
    {
      key: "holidays",
      label: intl.formatMessage({ id: "settings.tab.holidays" }),
      children: <HolidaysTab />,
    },
    {
      key: "workday",
      label: intl.formatMessage({ id: "settings.tab.workday" }),
      children: <WorkdayTab isOwner={currentUser?.role === "owner"} />,
    },
    {
      key: "mcp",
      label: intl.formatMessage({ id: "settings.tab.mcp" }),
      children: <McpTab />,
    },
  ];

  return (
    <PageContainer title={intl.formatMessage({ id: "menu.settings" })}>
      <Card variant="borderless" style={{ boxShadow: "none" }}>
        <Tabs
          items={tabItems}
          activeKey={activeTab}
          onChange={handleTabChange}
        />
      </Card>
    </PageContainer>
  );
};

export default SettingsPage;

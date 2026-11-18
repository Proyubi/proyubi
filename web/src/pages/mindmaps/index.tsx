// 思维导图列表页（/mindmaps）：独立文档卡片列表 + 新建/重命名/删除/关联项目。
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { PageContainer } from "@ant-design/pro-components";
import { useIntl, useNavigate } from "@umijs/max";
import {
  App as AntApp,
  Button,
  Card,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
} from "antd";
import { GitBranch, MoreVertical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createMindMap,
  deleteMindMap,
  listMindMaps,
  updateMindMap,
} from "@/pm/api";
import { useData } from "@/pm/store";
import type { MindMapSummary } from "@/pm/types";
import dayjs from "@/pm/utils/date";

export default function MindMapsPage() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const nav = useNavigate();
  const { message, modal } = AntApp.useApp();
  const { projects, customerMap, ensureBase } = useData();

  const [maps, setMaps] = useState<MindMapSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // 新建 / 编辑信息弹窗
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MindMapSummary | null>(null);
  const [form] = Form.useForm<{ name: string; projectId?: string }>();

  useEffect(() => {
    ensureBase();
  }, [ensureBase]);

  const reload = async () => {
    setLoading(true);
    try {
      setMaps(await listMindMaps());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    reload();
  }, []);

  const projectOptions = useMemo(
    () =>
      projects.map((p) => {
        const cust = customerMap[p.customerId];
        return {
          value: p.id,
          label: cust ? `${cust.shortName || cust.name} / ${p.name}` : p.name,
        };
      }),
    [projects, customerMap]
  );
  const projectLabel = (projectId: string | null) => {
    if (!projectId) return null;
    return projectOptions.find((o) => o.value === projectId)?.label ?? null;
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setFormOpen(true);
  };
  const openEdit = (m: MindMapSummary) => {
    setEditing(m);
    form.setFieldsValue({ name: m.name, projectId: m.projectId ?? undefined });
    setFormOpen(true);
  };

  const submitForm = async () => {
    const v = await form.validateFields();
    if (editing) {
      await updateMindMap(editing.id, {
        name: v.name,
        projectId: v.projectId ?? null,
        clearProject: !v.projectId,
      });
      message.success(t("mindmap.msg.updated"));
    } else {
      const created = await createMindMap({
        name: v.name,
        projectId: v.projectId ?? null,
      });
      message.success(t("mindmap.msg.created"));
      setFormOpen(false);
      nav(`/mindmaps/${created.id}`);
      return;
    }
    setFormOpen(false);
    reload();
  };

  const onDelete = (m: MindMapSummary) => {
    modal.confirm({
      title: t("mindmap.msg.confirmDelete", { name: m.name }),
      okType: "danger",
      okText: t("mindmap.act.delete"),
      onOk: async () => {
        await deleteMindMap(m.id);
        message.success(t("mindmap.msg.deleted"));
        reload();
      },
    });
  };

  return (
    <PageContainer
      title={t("mindmap.title")}
      extra={[
        <Button
          key="new"
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreate}
        >
          {t("mindmap.act.new")}
        </Button>,
      ]}
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: 64 }}>
          <Spin />
        </div>
      ) : maps.length === 0 ? (
        <Empty description={t("mindmap.empty")}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t("mindmap.act.new")}
          </Button>
        </Empty>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {maps.map((m) => (
            <Card
              key={m.id}
              hoverable
              styles={{ body: { padding: 16 } }}
              onClick={() => nav(`/mindmaps/${m.id}`)}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 0,
                  }}
                >
                  <GitBranch size={18} color="#2f6bff" />
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.name}
                  </span>
                </div>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      {
                        key: "edit",
                        icon: <EditOutlined />,
                        label: t("mindmap.act.editInfo"),
                      },
                      {
                        key: "delete",
                        icon: <DeleteOutlined />,
                        danger: true,
                        label: t("mindmap.act.delete"),
                      },
                    ],
                    onClick: ({ key, domEvent }) => {
                      domEvent.stopPropagation();
                      if (key === "edit") openEdit(m);
                      if (key === "delete") onDelete(m);
                    },
                  }}
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<MoreVertical size={16} />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Dropdown>
              </div>

              <div style={{ marginTop: 12, minHeight: 24 }}>
                {projectLabel(m.projectId) ? (
                  <Tag color="blue">{projectLabel(m.projectId)}</Tag>
                ) : (
                  <Tag>{t("mindmap.noProject")}</Tag>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
                {t("mindmap.updatedAt", {
                  time: dayjs(m.updatedAt).format("YYYY-MM-DD HH:mm"),
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        title={editing ? t("mindmap.act.editInfo") : t("mindmap.act.new")}
        onOk={submitForm}
        onCancel={() => setFormOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="name"
            label={t("mindmap.field.name")}
            rules={[{ required: true, message: t("mindmap.field.nameRequired") }]}
          >
            <Input placeholder={t("mindmap.field.namePlaceholder")} maxLength={60} />
          </Form.Item>
          <Form.Item name="projectId" label={t("mindmap.field.project")}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t("mindmap.field.projectPlaceholder")}
              options={projectOptions}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}

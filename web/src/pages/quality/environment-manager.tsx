import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import type { App as AntApp } from "antd";
import { Button, Form, Input, Modal, Popconfirm, Space, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useState } from "react";
import * as api from "@/pm/api";
import type { Environment } from "@/pm/types";

type AppApi = ReturnType<typeof AntApp.useApp>;

export interface EnvironmentManagerProps {
  open: boolean;
  customerId?: string;
  environments: Environment[];
  onClose: () => void;
  onChanged: () => void;
  t: (id: string, v?: Record<string, string | number>) => string;
  message: AppApi["message"];
}

/**
 * 環境マスタ（バグ票の動作環境）の管理モーダル。製品(顧客)ごと。
 * 区分名(dev/stg/prod)・端末/ブラウザ・URL を登録し、バグ編集で選択できるようにする。
 */
export default function EnvironmentManager(p: EnvironmentManagerProps) {
  const { t, message, customerId } = p;
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setEditingId(null);
    form.setFieldsValue({
      name: undefined,
      browser: undefined,
      url: undefined,
    });
  }, [form]);

  useEffect(() => {
    if (p.open) resetForm();
  }, [p.open, resetForm]);

  const edit = (e: Environment) => {
    setEditingId(e.id);
    form.setFieldsValue({
      name: e.name,
      browser: e.browser ?? undefined,
      url: e.url ?? undefined,
    });
  };

  const submit = async () => {
    const v = await form.validateFields();
    if (!customerId) return;
    setSaving(true);
    try {
      if (editingId) {
        await api.updateEnvironment(editingId, {
          name: v.name,
          browser: v.browser ?? "",
          url: v.url ?? "",
        });
      } else {
        await api.createEnvironment(customerId, {
          name: v.name,
          browser: v.browser,
          url: v.url,
        });
      }
      message.success(t("quality.msg.saved"));
      resetForm();
      p.onChanged();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (e: Environment) => {
    await api.deleteEnvironment(e.id);
    message.success(t("quality.msg.deleted"));
    if (editingId === e.id) resetForm();
    p.onChanged();
  };

  const columns: ColumnsType<Environment> = [
    { title: t("quality.env.name"), dataIndex: "name", width: 120 },
    {
      title: t("quality.env.browser"),
      dataIndex: "browser",
      width: 140,
      render: (v?: string) => v || "—",
    },
    {
      title: t("quality.env.url"),
      dataIndex: "url",
      ellipsis: true,
      render: (v?: string) => v || "—",
    },
    {
      title: t("quality.common.actions"),
      width: 110,
      render: (_: unknown, r: Environment) => (
        <Space>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => edit(r)}
          />
          <Popconfirm
            title={t("quality.env.deleteConfirm")}
            onConfirm={() => remove(r)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title={t("quality.env.manage")}
      open={p.open}
      onCancel={p.onClose}
      footer={<Button onClick={p.onClose}>{t("quality.common.close")}</Button>}
      width={720}
      destroyOnClose
    >
      <Form form={form} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item
          name="name"
          rules={[{ required: true }]}
          style={{ marginBottom: 8 }}
        >
          <Input
            placeholder={t("quality.env.namePlaceholder")}
            style={{ width: 120 }}
          />
        </Form.Item>
        <Form.Item name="browser" style={{ marginBottom: 8 }}>
          <Input
            placeholder={t("quality.env.browserPlaceholder")}
            style={{ width: 140 }}
          />
        </Form.Item>
        <Form.Item name="url" style={{ marginBottom: 8 }}>
          <Input
            placeholder={t("quality.env.urlPlaceholder")}
            style={{ width: 240 }}
          />
        </Form.Item>
        <Form.Item style={{ marginBottom: 8 }}>
          <Space>
            <Button type="primary" loading={saving} onClick={submit}>
              {editingId ? t("quality.common.save") : t("quality.common.add")}
            </Button>
            {editingId && (
              <Button onClick={resetForm}>{t("quality.common.cancel")}</Button>
            )}
          </Space>
        </Form.Item>
      </Form>
      <Table<Environment>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={p.environments}
        pagination={false}
        locale={{ emptyText: t("quality.env.empty") }}
      />
    </Modal>
  );
}

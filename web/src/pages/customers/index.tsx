import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  Modal,
  Form,
  Table,
  Space,
  Empty,
  Spin,
  Tag,
  Switch,
  Popconfirm,
  Card,
  App as AntApp,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { PageContainer } from "@ant-design/pro-components";
import type { ColumnsType } from "antd/es/table";
import { useIntl } from "@umijs/max";
import { useData } from "@/pm/store";
import { fmt } from "@/pm/utils/date";
import type { Customer } from "@/pm/types";
import "./index.css";

export default function CustomerListPage() {
  const {
    customers,
    projects,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    ensureBase,
    baseLoaded,
  } = useData();
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const { message } = AntApp.useApp();
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    ensureBase();
  }, [ensureBase]);

  // 每个客户名下的项目数（删除前提示用）
  const projectCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of projects) m[p.customerId] = (m[p.customerId] ?? 0) + 1;
    return m;
  }, [projects]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return customers;
    return customers.filter((c) =>
      `${c.name} ${c.shortName ?? ""}`.toLowerCase().includes(kw)
    );
  }, [customers, keyword]);

  const openCreate = () => {
    setEditing(undefined);
    form.resetFields();
    form.setFieldsValue({ active: true });
    setOpen(true);
  };
  const openEdit = (c: Customer) => {
    setEditing(c);
    form.setFieldsValue({
      name: c.name,
      shortName: c.shortName,
      active: c.active !== false,
    });
    setOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        await updateCustomer(editing.id, v.name, v.shortName, v.active);
        message.success(t("customers.msg.saved"));
      } else {
        await addCustomer(v.name, v.shortName, undefined, v.active);
        message.success(t("customers.msg.created"));
      }
      setOpen(false);
      form.resetFields();
    } finally {
      setSubmitting(false);
    }
  };

  // 行内快速切换有效/无效
  const toggleActive = async (c: Customer, next: boolean) => {
    await updateCustomer(c.id, c.name, c.shortName, next);
    message.success(t("customers.msg.saved"));
  };

  const remove = async (c: Customer) => {
    await deleteCustomer(c.id);
    message.success(t("common.deleted"));
  };

  const columns: ColumnsType<Customer> = [
    {
      title: t("customers.col.name"),
      dataIndex: "name",
      key: "name",
      render: (name: string) => <span>{name}</span>,
    },
    {
      title: t("customers.col.shortName"),
      dataIndex: "shortName",
      key: "shortName",
      render: (s?: string) => s || <span className="cust-muted">—</span>,
    },
    {
      title: (
        <span style={{ whiteSpace: "nowrap" }}>
          {t("customers.col.projectCount")}
        </span>
      ),
      key: "count",
      width: 110,
      render: (_, c) => <Tag>{projectCount[c.id] ?? 0}</Tag>,
    },
    {
      title: t("customers.col.status"),
      key: "active",
      width: 120,
      render: (_, c) => {
        const active = c.active !== false;
        return (
          <Space size={6}>
            <Switch
              size="small"
              checked={active}
              onChange={(next) => toggleActive(c, next)}
            />
            <Tag color={active ? "green" : "default"}>
              {active
                ? t("customers.status.active")
                : t("customers.status.inactive")}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: t("customers.col.createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      width: 140,
      render: (v?: string) =>
        v ? fmt(v) : <span className="cust-muted">—</span>,
    },
    {
      title: t("common.action"),
      key: "action",
      width: 160,
      render: (_, c) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(c)}
          >
            {t("common.edit")}
          </Button>
          <Popconfirm
            title={t("customers.delete.title", { name: c.name })}
            description={
              (projectCount[c.id] ?? 0) > 0
                ? t("customers.delete.hasProjects", {
                    count: projectCount[c.id],
                  })
                : t("customers.delete.irreversible")
            }
            okText={t("common.delete")}
            okButtonProps={{ danger: true }}
            cancelText={t("common.cancel")}
            onConfirm={() => remove(c)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              {t("common.delete")}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      title={t("customers.title")}
      subTitle={t("customers.subtitle")}
      extra={[
        <Button
          key="new"
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreate}
        >
          {t("customers.new")}
        </Button>,
      ]}
    >
      <Card size="small" styles={{ body: { padding: "12px 16px 4px" } }}>
        <div className="cust-toolbar">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("customers.search.placeholder")}
            style={{ width: 280 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        {!baseLoaded ? (
          <div className="cust-loading">
            <Spin size="large" />
          </div>
        ) : (
          <Table<Customer>
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            pagination={{
              defaultPageSize: 10,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              showTotal: (total) => t("customers.count", { count: total }),
            }}
            locale={{
              emptyText: <Empty description={t("customers.empty")} />,
            }}
          />
        )}
      </Card>

      <Modal
        title={editing ? t("customers.edit") : t("customers.new")}
        open={open}
        onOk={submit}
        confirmLoading={submitting}
        onCancel={() => setOpen(false)}
        okText={editing ? t("common.save") : t("customers.create")}
        cancelText={t("common.cancel")}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="name"
            label={t("customers.form.name")}
            rules={[
              { required: true, message: t("customers.form.name.required") },
            ]}
          >
            <Input placeholder={t("customers.form.name.placeholder")} />
          </Form.Item>
          <Form.Item name="shortName" label={t("customers.form.shortName")}>
            <Input placeholder={t("customers.form.shortName.placeholder")} />
          </Form.Item>
          <Form.Item
            name="active"
            label={t("customers.form.active")}
            valuePropName="checked"
            tooltip={t("customers.form.active.tip")}
          >
            <Switch
              checkedChildren={t("customers.status.active")}
              unCheckedChildren={t("customers.status.inactive")}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}

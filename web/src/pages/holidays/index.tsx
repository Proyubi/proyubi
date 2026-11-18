import { PageContainer } from "@ant-design/pro-components";
import { useIntl } from "@umijs/max";
import {
  CloudSyncOutlined,
  ImportOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { useData } from "@/pm/store";
import type { Holiday } from "@/pm/types";
import { ISO } from "@/pm/utils/date";

/** 批量导入：每行 `YYYY-MM-DD<分隔>名称`，分隔符为逗号/制表符/空格；忽略空行与非法行。 */
function parseImport(text: string): { date: string; name: string }[] {
  const out: { date: string; name: string }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2})[,\t\s]+(.+)$/);
    if (!m) continue;
    const date = dayjs(m[1].replace(/\//g, "-")).format(ISO);
    if (date === "Invalid Date") continue;
    out.push({ date, name: m[2].trim() });
  }
  return out;
}

export default function HolidaysPage() {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id }, values);
  const {
    holidayList,
    ensureBase,
    addHoliday,
    editHoliday,
    removeHoliday,
    importHolidays,
    syncHolidays,
  } = useData();

  useEffect(() => {
    ensureBase();
  }, [ensureBase]);

  const [syncing, setSyncing] = useState(false);
  const [year, setYear] = useState<string>("all");
  const [editTarget, setEditTarget] = useState<Holiday | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ date: dayjs.Dayjs; name: string }>();
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const years = useMemo(
    () =>
      Array.from(new Set(holidayList.map((h) => h.holidayDate.slice(0, 4))))
        .sort()
        .reverse(),
    [holidayList]
  );
  const filtered = useMemo(
    () =>
      year === "all"
        ? holidayList
        : holidayList.filter((h) => h.holidayDate.startsWith(year)),
    [holidayList, year]
  );

  const onSync = async () => {
    setSyncing(true);
    try {
      const r = await syncHolidays();
      message.success(t("pages.holidays.syncSuccess", r));
    } finally {
      setSyncing(false);
    }
  };

  const openAdd = () => {
    setEditTarget(null);
    form.resetFields();
    setFormOpen(true);
  };
  const openEdit = (h: Holiday) => {
    setEditTarget(h);
    form.setFieldsValue({ date: dayjs(h.holidayDate), name: h.name });
    setFormOpen(true);
  };

  const submitForm = async () => {
    const v = await form.validateFields();
    const date = v.date.format(ISO);
    setSaving(true);
    try {
      if (editTarget) {
        await editHoliday(editTarget.id, date, v.name.trim());
      } else {
        await addHoliday(date, v.name.trim());
      }
      message.success(t("pages.holidays.saved"));
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const submitImport = async () => {
    const rows = parseImport(importText);
    if (rows.length === 0) {
      message.warning(t("pages.holidays.importEmpty"));
      return;
    }
    setImporting(true);
    try {
      const added = await importHolidays(rows);
      message.success(t("pages.holidays.importResult", { added }));
      setImportOpen(false);
      setImportText("");
    } finally {
      setImporting(false);
    }
  };

  const columns: ColumnsType<Holiday> = [
    {
      title: t("pages.holidays.col.date"),
      dataIndex: "holidayDate",
      width: 160,
      render: (v: string) => dayjs(v).format("YYYY/MM/DD ( dd)"),
    },
    { title: t("pages.holidays.col.name"), dataIndex: "name" },
    {
      title: t("pages.holidays.col.source"),
      dataIndex: "isManual",
      width: 120,
      render: (manual: boolean) =>
        manual ? (
          <Tag color="blue">{t("pages.holidays.source.manual")}</Tag>
        ) : (
          <Tag>{t("pages.holidays.source.synced")}</Tag>
        ),
    },
    {
      title: t("pages.holidays.col.action"),
      width: 140,
      render: (_, h) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => openEdit(h)}>
            {t("pages.holidays.edit")}
          </Button>
          <Popconfirm
            title={t("pages.holidays.deleteConfirm")}
            onConfirm={() => removeHoliday(h.id)}
          >
            <Button type="link" size="small" danger>
              {t("pages.holidays.delete")}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      header={{ title: t("pages.holidays.title") }}
      extra={[
        <Select
          key="year"
          value={year}
          onChange={setYear}
          style={{ width: 120 }}
          options={[
            { value: "all", label: t("pages.holidays.yearAll") },
            ...years.map((y) => ({ value: y, label: y })),
          ]}
        />,
        <Button
          key="import"
          icon={<ImportOutlined />}
          onClick={() => setImportOpen(true)}
        >
          {t("pages.holidays.import")}
        </Button>,
        <Button key="add" icon={<PlusOutlined />} onClick={openAdd}>
          {t("pages.holidays.add")}
        </Button>,
        <Button
          key="sync"
          type="primary"
          icon={<CloudSyncOutlined />}
          loading={syncing}
          onClick={onSync}
        >
          {t("pages.holidays.syncNow")}
        </Button>,
      ]}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t("pages.holidays.teamHint")}
      />
      <Card>
        <Table<Holiday>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{
            emptyText: <Empty description={t("pages.holidays.empty")} />,
          }}
        />
      </Card>

      <Modal
        open={formOpen}
        title={
          editTarget
            ? t("pages.holidays.editTitle")
            : t("pages.holidays.addTitle")
        }
        onCancel={() => setFormOpen(false)}
        onOk={submitForm}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="date"
            label={t("pages.holidays.form.date")}
            rules={[
              {
                required: true,
                message: t("pages.holidays.form.dateRequired"),
              },
            ]}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="name"
            label={t("pages.holidays.form.name")}
            rules={[
              {
                required: true,
                message: t("pages.holidays.form.nameRequired"),
              },
            ]}
          >
            <Input placeholder={t("pages.holidays.form.namePlaceholder")} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={importOpen}
        title={t("pages.holidays.importTitle")}
        onCancel={() => setImportOpen(false)}
        onOk={submitImport}
        confirmLoading={importing}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t("pages.holidays.importHint")}
        />
        <Input.TextArea
          rows={10}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={"2026-01-01,元日\n2026-01-12,成人の日"}
        />
      </Modal>
    </PageContainer>
  );
}

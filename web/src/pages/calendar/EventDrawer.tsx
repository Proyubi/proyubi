import { useIntl } from "@umijs/max";
import {
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  message,
  Popconfirm,
  Select,
  Space,
  Switch,
} from "antd";
import { useEffect } from "react";
import { createEvent, deleteEvent, updateEvent } from "@/pm/api";
import { useData } from "@/pm/store";
import type { EventReq, PmEvent, PmEventType } from "@/pm/types";
import dayjs from "@/pm/utils/date";

/** 事件种别（与后端 5 枚举一致） */
const EVENT_TYPES: PmEventType[] = [
  "meeting",
  "review",
  "milestone",
  "deadline",
  "other",
];

interface FormShape {
  title: string;
  type: PmEventType;
  allDay: boolean;
  start: ReturnType<typeof dayjs> | null;
  end: ReturnType<typeof dayjs> | null;
  projectId?: string | null;
  taskId?: string | null;
  attendeeIds?: string[];
  location?: string | null;
  note?: string | null;
}

export interface EventDrawerProps {
  open: boolean;
  /** 编辑态：传入既有事件；新建态为 null */
  event: PmEvent | null;
  /** 新建态默认日期（点空白格带入）；YYYY-MM-DD */
  defaultDate?: string | null;
  onClose: () => void;
  /** 保存/删除成功后回调（触发列表刷新） */
  onSaved: () => void;
}

/** 事件 CRUD 抽屉：新建 / 编辑 / 删除，不跳页。 */
export default function EventDrawer({
  open,
  event,
  defaultDate,
  onClose,
  onSaved,
}: EventDrawerProps) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { members, projects } = useData();
  const [form] = Form.useForm<FormShape>();
  const allDay = Form.useWatch("allDay", form);
  const isEdit = !!event;

  // 打开时回显（编辑）或带默认日期（新建）
  useEffect(() => {
    if (!open) return;
    if (event) {
      form.setFieldsValue({
        title: event.title,
        type: event.type,
        allDay: event.allDay,
        start: event.startAt ? dayjs(event.startAt) : null,
        end: event.endAt ? dayjs(event.endAt) : null,
        projectId: event.projectId,
        taskId: event.taskId,
        attendeeIds: event.attendeeIds ?? [],
        location: event.location,
        note: event.note,
      });
    } else {
      const base = defaultDate ? dayjs(defaultDate) : dayjs();
      form.setFieldsValue({
        title: "",
        type: "meeting",
        allDay: false,
        start: base.hour(10).minute(0).second(0),
        end: null,
        projectId: null,
        taskId: null,
        attendeeIds: [],
        location: null,
        note: null,
      });
    }
  }, [open, event, defaultDate, form]);

  const submit = async () => {
    const v = await form.validateFields();
    const fmt = v.allDay ? "YYYY-MM-DDT00:00:00" : "YYYY-MM-DDTHH:mm:ss";
    const body: EventReq = {
      title: v.title.trim(),
      type: v.type,
      startAt: v.start ? v.start.format(fmt) : "",
      endAt: v.end ? v.end.format(fmt) : null,
      allDay: v.allDay,
      projectId: v.projectId ?? null,
      taskId: v.taskId ?? null,
      attendeeIds: v.attendeeIds ?? [],
      location: v.location ?? null,
      note: v.note ?? null,
    };
    if (event) {
      await updateEvent(event.id, body);
    } else {
      await createEvent(body);
    }
    message.success(t("event.saved"));
    onSaved();
    onClose();
  };

  const remove = async () => {
    if (!event) return;
    await deleteEvent(event.id);
    message.success(t("event.deleted"));
    onSaved();
    onClose();
  };

  return (
    <Drawer
      title={isEdit ? t("event.edit") : t("event.new")}
      open={open}
      onClose={onClose}
      width={560}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>{t("event.cancel")}</Button>
          <Button type="primary" onClick={submit}>
            {t("event.save")}
          </Button>
        </Space>
      }
      footer={
        isEdit ? (
          <Popconfirm
            title={t("event.deleteConfirm")}
            onConfirm={remove}
            okText={t("event.delete")}
            cancelText={t("event.cancel")}
          >
            <Button danger>{t("event.delete")}</Button>
          </Popconfirm>
        ) : null
      }
    >
      <Form<FormShape> form={form} layout="vertical">
        <Form.Item
          name="title"
          label={t("event.field.title")}
          rules={[{ required: true, message: t("event.validate.title") }]}
        >
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 6 }}
            maxLength={120}
          />
        </Form.Item>

        <Form.Item
          name="type"
          label={t("event.field.type")}
          rules={[{ required: true }]}
        >
          <Select
            options={EVENT_TYPES.map((type) => ({
              value: type,
              label: t(`event.type.${type}`),
            }))}
          />
        </Form.Item>

        <Form.Item
          name="allDay"
          label={t("event.field.allDay")}
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="start"
          label={t("event.field.start")}
          rules={[{ required: true, message: t("event.validate.time") }]}
        >
          <DatePicker
            style={{ width: "100%" }}
            showTime={allDay ? false : { format: "HH:mm" }}
          />
        </Form.Item>

        <Form.Item
          name="end"
          label={t("event.field.end")}
          dependencies={["start"]}
          rules={[
            ({ getFieldValue }) => ({
              validator(_, value) {
                const start = getFieldValue("start");
                if (!value || !start || !value.isBefore(start)) {
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(t("event.validate.endBeforeStart"))
                );
              },
            }),
          ]}
        >
          <DatePicker
            style={{ width: "100%" }}
            showTime={allDay ? false : { format: "HH:mm" }}
          />
        </Form.Item>

        <Form.Item name="projectId" label={t("event.field.project")}>
          <Select
            allowClear
            placeholder={t("event.field.project")}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item name="attendeeIds" label={t("event.field.attendees")}>
          <Select
            mode="multiple"
            allowClear
            placeholder={t("event.field.attendees")}
            options={members.map((m) => ({ value: m.id, label: m.name }))}
            optionFilterProp="label"
          />
        </Form.Item>

        <Form.Item name="location" label={t("event.field.location")}>
          <Input maxLength={200} />
        </Form.Item>

        <Form.Item name="note" label={t("event.field.note")}>
          <Input.TextArea rows={3} maxLength={500} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

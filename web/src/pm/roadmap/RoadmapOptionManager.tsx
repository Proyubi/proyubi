import { useState } from "react";
import { useIntl } from "@umijs/max";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  ColorPicker,
  Input,
  message,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from "antd";
import { useData } from "../store";
import type { RoadmapOption, RoadmapOptionKind } from "../types";

/** 新增字典项的默认颜色（按用途给个合理初值） */
const DEFAULT_COLOR: Record<RoadmapOptionKind, string> = {
  lane: "#1677ff",
  ms_color: "#8c8c8c",
};

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 路线图字典管理（泳道 / 里程碑色）。租户级，修改对整个团队生效。
 * 取代原先写死在前端的枚举/顺序/颜色。
 */
export default function RoadmapOptionManager({ open, onClose }: Props) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t("projects.roadmap.optionManager.title")}
      footer={null}
      width={560}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        message={t("projects.roadmap.optionManager.teamHint")}
        style={{ marginBottom: 16 }}
      />
      <Section kind="lane" title={t("projects.roadmap.optionManager.laneSection")} addLabel={t("projects.roadmap.optionManager.addLane")} />
      <div style={{ height: 20 }} />
      <Section
        kind="ms_color"
        title={t("projects.roadmap.optionManager.msColorSection")}
        addLabel={t("projects.roadmap.optionManager.addMsColor")}
      />
    </Modal>
  );
}

function Section({
  kind,
  title,
  addLabel,
}: {
  kind: RoadmapOptionKind;
  title: string;
  addLabel: string;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { roadmapOptionsOf, addRoadmapOption, reorderRoadmapOptions } =
    useData();
  const items = roadmapOptionsOf(kind);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const ids = items.map((o) => o.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await reorderRoadmapOptions(kind, ids);
  };

  const add = async () => {
    const label = newName.trim();
    if (!label) {
      message.warning(t("projects.roadmap.optionManager.nameRequired"));
      return;
    }
    setAdding(true);
    try {
      await addRoadmapOption({ kind, label, color: DEFAULT_COLOR[kind] });
      setNewName("");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <Typography.Text strong>{title}</Typography.Text>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((opt, i) => (
          <Row
            key={opt.id}
            opt={opt}
            isFirst={i === 0}
            isLast={i === items.length - 1}
            onMoveUp={() => move(i, -1)}
            onMoveDown={() => move(i, 1)}
          />
        ))}
      </div>
      <Space.Compact style={{ marginTop: 8, width: "100%" }}>
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={add}
          placeholder={t("projects.roadmap.optionManager.namePlaceholder")}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={adding}
          onClick={add}
        >
          {addLabel}
        </Button>
      </Space.Compact>
    </div>
  );
}

function Row({
  opt,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: {
  opt: RoadmapOption;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { updateRoadmapOption, deleteRoadmapOption } = useData();
  const [name, setName] = useState(opt.label);

  const commitName = () => {
    const label = name.trim();
    if (!label || label === opt.label) {
      setName(opt.label);
      return;
    }
    updateRoadmapOption(opt.id, { label });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <ColorPicker
        value={opt.color ?? DEFAULT_COLOR[opt.kind]}
        onChangeComplete={(c) =>
          updateRoadmapOption(opt.id, { color: c.toHexString() })
        }
      />
      <Input
        size="small"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onPressEnter={commitName}
        style={{ flex: 1 }}
      />
      {opt.isSystem && (
        <Tag color="default" style={{ marginInlineEnd: 0 }}>
          {t("projects.roadmap.optionManager.system")}
        </Tag>
      )}
      <Button
        size="small"
        type="text"
        icon={<ArrowUpOutlined />}
        disabled={isFirst}
        onClick={onMoveUp}
      />
      <Button
        size="small"
        type="text"
        icon={<ArrowDownOutlined />}
        disabled={isLast}
        onClick={onMoveDown}
      />
      <Popconfirm
        title={t("projects.roadmap.optionManager.deleteConfirm")}
        onConfirm={() => deleteRoadmapOption(opt.id)}
        disabled={opt.isSystem}
      >
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          disabled={opt.isSystem}
        />
      </Popconfirm>
    </div>
  );
}

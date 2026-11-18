import { PlusOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';

export default function SubProjectAddButton({
  kind, parentId, disabled = false, label, onAdd,
}: {
  kind?: string | null;
  parentId?: string | null;
  disabled?: boolean;
  label: string;
  onAdd: () => void;
}) {
  if (kind === 'ops' || parentId) return null;
  return (
    <Tooltip title={label}>
      <Button
        type="text"
        size="small"
        className="pm-parent-add"
        aria-label={label}
        disabled={disabled}
        icon={<PlusOutlined />}
        onClick={(event) => { event.stopPropagation(); onAdd(); }}
      />
    </Tooltip>
  );
}

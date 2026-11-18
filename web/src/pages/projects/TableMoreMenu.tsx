import {
  AppstoreOutlined,
  BarsOutlined,
  ColumnHeightOutlined,
  LayoutOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import type { MenuProps } from 'antd';
import { Button, Checkbox, Dropdown, Popover } from 'antd';
import { type ReactNode, useRef, useState } from 'react';

/** 表示形式とテーブル設定を独立したボタンで操作する。
 * 状態・ユーザー別の保存は呼び出し側で管理する。
 */

export type TableDensity = 'large' | 'middle' | 'small';
export type ProjectViewMode = 'list' | 'card';
const VIEW_MODES: {
  value: ProjectViewMode;
  i18nKey: string;
  icon: ReactNode;
}[] = [
  { value: 'list', i18nKey: 'projects.viewMode.list', icon: <BarsOutlined /> },
  {
    value: 'card',
    i18nKey: 'projects.viewMode.card',
    icon: <AppstoreOutlined />,
  },
];
const DENSITIES: { value: TableDensity; i18nKey: string }[] = [
  { value: 'large', i18nKey: 'projects.more.density.large' },
  { value: 'middle', i18nKey: 'projects.more.density.middle' },
  { value: 'small', i18nKey: 'projects.more.density.small' },
];

export default function TableMoreMenu({
  viewMode,
  onViewMode,
  onReload,
  density,
  onDensity,
  columns,
  hiddenColumns,
  onHiddenColumns,
}: {
  viewMode: ProjectViewMode;
  onViewMode: (v: ProjectViewMode) => void;
  onReload: () => void;
  density: TableDensity;
  onDensity: (v: TableDensity) => void;
  /** 表示 / 非表示を切り替えられる列（名前・操作列のような必須列は渡さない） */
  columns: { key: string; label: string }[];
  hiddenColumns: string[];
  onHiddenColumns: (keys: string[]) => void;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const viewButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const columnsContent = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  // カード表示では密度・列設定が効かないので出さない
  const tableOptionsEnabled = viewMode === 'list';
  const items: MenuProps['items'] = [
    {
      key: 'reload',
      icon: <ReloadOutlined />,
      label: t('projects.more.reload'),
    },
    ...(tableOptionsEnabled
      ? [
          {
            key: 'density',
            icon: <ColumnHeightOutlined />,
            label: t('projects.more.density'),
            children: DENSITIES.map((d) => ({
              key: `density:${d.value}`,
              label: t(d.i18nKey),
            })),
          },
          {
            key: 'columns',
            icon: <SettingOutlined />,
            label: `${t('projects.more.columns')}…`,
          },
        ]
      : []),
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    setMenuOpen(false);
    if (key === 'reload') onReload();
    else if (key === 'columns') setColumnsOpen(true);
    else if (key.startsWith('density:')) {
      onDensity(key.slice('density:'.length) as TableDensity);
    }
    if (key !== 'columns') settingsButton.current?.focus();
  };

  const hidden = new Set(hiddenColumns);
  const columnsPanel = (
    <div
      role="dialog"
      aria-label={t('projects.more.columns')}
      tabIndex={-1}
      className="pm-more-cols"
      ref={columnsContent}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          setColumnsOpen(false);
          settingsButton.current?.focus();
        }
      }}
    >
      {columns.map((c) => (
        <Checkbox
          key={c.key}
          checked={!hidden.has(c.key)}
          onChange={(e) =>
            onHiddenColumns(
              e.target.checked
                ? hiddenColumns.filter((k) => k !== c.key)
                : [...hiddenColumns, c.key],
            )
          }
        >
          {c.label}
        </Checkbox>
      ))}
      <Button
        type="link"
        size="small"
        className="pm-more-cols-reset"
        disabled={hiddenColumns.length === 0}
        onClick={() => onHiddenColumns([])}
      >
        {t('projects.more.columnsReset')}
      </Button>
    </div>
  );

  return (
    <div className="pm-project-view-controls">
      <Dropdown
        autoFocus
        open={viewOpen}
        onOpenChange={(open) => {
          setViewOpen(open);
          if (open) {
            setMenuOpen(false);
            setColumnsOpen(false);
          }
        }}
        trigger={['click']}
        placement="bottomRight"
        menu={{
          items: VIEW_MODES.map((v) => ({
            key: v.value,
            icon: v.icon,
            label: t(v.i18nKey),
          })),
          selectable: true,
          selectedKeys: [viewMode],
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              setViewOpen(false);
              viewButton.current?.focus();
            }
          },
          onClick: ({ key }) => {
            onViewMode(key as ProjectViewMode);
            setViewOpen(false);
            viewButton.current?.focus();
          },
        }}
      >
        <Button
          type="text"
          ref={viewButton}
          icon={<LayoutOutlined />}
          title={t('projects.viewMode.label')}
          aria-label={t('projects.viewMode.label')}
          aria-haspopup="menu"
          aria-expanded={viewOpen}
        />
      </Dropdown>
      <Popover
        // 設定ボタンでは開かず、メニューの「列の表示設定」から開く。
        // 外側クリックで閉じる通知だけ受け取る
        open={columnsOpen && tableOptionsEnabled}
        onOpenChange={(o) => {
          if (!o) setColumnsOpen(false);
        }}
        trigger="click"
        afterOpenChange={(open) => {
          if (open)
            columnsContent.current
              ?.querySelector<HTMLInputElement>('input')
              ?.focus();
        }}
        placement="bottomRight"
        title={t('projects.more.columns')}
        content={columnsPanel}
      >
        <span>
          <Dropdown
            autoFocus
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open);
              if (open) {
                setViewOpen(false);
                setColumnsOpen(false);
              }
            }}
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items,
              onClick,
              selectable: true,
              selectedKeys: [`density:${density}`],
              onKeyDown: (event) => {
                if (event.key === 'Escape') {
                  setMenuOpen(false);
                  settingsButton.current?.focus();
                }
              },
            }}
          >
            <Button
              type="text"
              ref={settingsButton}
              icon={<SettingOutlined />}
              title={t('projects.more.settings')}
              aria-label={t('projects.more.settings')}
              aria-haspopup="menu"
              aria-expanded={menuOpen || columnsOpen}
            />
          </Dropdown>
        </span>
      </Popover>
    </div>
  );
}

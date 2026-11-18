import { useIntl } from "@umijs/max";
import {
  Alert,
  Button,
  Divider,
  InputNumber,
  Space,
  Typography,
  message,
} from "antd";
import { useEffect, useState } from "react";
import { useData } from "@/pm/store";

/**
 * 工数設定タブ（1営業日 = 何時間）。
 * ワークスペース全体の工期 ↔ 時間の換算単位を設定する。既定 8h、7.5 等の小数可。
 * この値は既存タスクの日数/時間データを書き換えず、換算の解釈だけを変える。
 * 変更はオーナーのみ（バックエンドでも assertOwner で保護）。
 */
export default function WorkdayTab({ isOwner }: { isOwner?: boolean }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const { hoursPerWorkday, updateHoursPerWorkday, ensureBase } = useData();
  const [val, setVal] = useState<number | null>(hoursPerWorkday);
  const [saving, setSaving] = useState(false);

  // 直接この設定タブに着地しても値を取得（store は遅延ロード）
  useEffect(() => {
    ensureBase();
  }, [ensureBase]);
  // store の値が更新されたら入力欄へ反映
  useEffect(() => {
    setVal(hoursPerWorkday);
  }, [hoursPerWorkday]);

  const dirty = val != null && val !== hoursPerWorkday;

  const onSave = async () => {
    if (val == null || Number.isNaN(val) || val < 1 || val > 24) {
      message.error(t("pages.workday.range"));
      return;
    }
    setSaving(true);
    try {
      await updateHoursPerWorkday(val);
      message.success(t("pages.workday.saved"));
    } catch {
      // request 层で 401/業務エラーは共通ハンドリング済み
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("pages.workday.title")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        {t("pages.workday.desc")}
      </Typography.Paragraph>

      <Space align="center" size={12} wrap style={{ marginTop: 8 }}>
        <span>{t("pages.workday.label")}</span>
        <InputNumber
          min={1}
          max={24}
          step={0.5}
          precision={2}
          value={val}
          onChange={(v) => setVal(v)}
          disabled={!isOwner || saving}
          addonAfter={t("pages.workday.unit")}
          style={{ width: 160 }}
        />
        <Button
          type="primary"
          onClick={onSave}
          loading={saving}
          disabled={!isOwner || !dirty}
        >
          {t("pages.workday.save")}
        </Button>
      </Space>

      <Divider style={{ margin: "16px 0" }} />

      <Alert
        type="info"
        showIcon
        message={
          isOwner
            ? t("pages.workday.teamHint")
            : t("pages.workday.ownerOnly")
        }
        description={t("pages.workday.note")}
      />
    </div>
  );
}

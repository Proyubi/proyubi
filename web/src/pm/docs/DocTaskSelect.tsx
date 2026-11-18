import { useIntl } from "@umijs/max";
import { Select } from "antd";
import { useMemo } from "react";
import type { Task } from "../types";
import { taskPathOptions } from "../utils/doc";

interface Props {
  tasks: Task[];
  value?: string[];
  onChange?: (ids: string[]) => void;
  loading?: boolean;
  placeholder?: string;
}

/**
 * 資料を紐付けるタスクの複数選択。葉・サマリーどちらも選べる。
 * 候補は WBS の表示順で、ドロップダウンでは「親 / 子 / 孫」のパスを出し、パスでも検索できる。
 * 選択済みタグはタスク名だけ（パスだと長すぎる）。Form.Item の子として value/onChange で使う。
 */
export default function DocTaskSelect({
  tasks,
  value,
  onChange,
  loading,
  placeholder,
}: Props) {
  const intl = useIntl();
  const options = useMemo(
    () =>
      taskPathOptions(tasks).map((o) => ({
        value: o.id,
        label: o.name,
        path: o.path,
      })),
    [tasks]
  );
  return (
    <Select
      mode="multiple"
      allowClear
      loading={loading}
      value={value}
      onChange={onChange}
      placeholder={
        placeholder ?? intl.formatMessage({ id: "docs.form.tasks.placeholder" })
      }
      options={options}
      optionFilterProp="path"
      optionRender={(opt) => (
        <span className="pm-doc-taskopt" title={opt.data.path as string}>
          {opt.data.path as string}
        </span>
      )}
      maxTagCount="responsive"
      style={{ width: "100%" }}
    />
  );
}

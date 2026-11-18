import { ArrowRightOutlined, LinkOutlined } from "@ant-design/icons";
import { useIntl, useNavigate } from "@umijs/max";
import { App, Button, Empty, List, Modal, Select, Space, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  batchLinkBugTask,
  listBugsByCustomer,
  listBugsByTask,
  listCasesByTask,
} from "../api";
import {
  BUG_STATUS_META,
  type Bug,
  type TestCase,
  type TestResult,
  TEST_RESULT_META,
} from "../types";
import { bugDisplayNo } from "../utils/bug";

/**
 * タスクドロワー用：当該タスクに紐づくテストケース一覧（読み取り専用）。
 * 詳細操作は品質管理ページへ誘導（ケース⇄タスクの双方向可視化）。
 */
export function TaskTestCases({
  taskId,
  customerId,
}: {
  taskId: string;
  customerId?: string;
}) {
  const intl = useIntl();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listCasesByTask(taskId)
      .then((r) => alive && setRows(r ?? []))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [taskId]);

  if (!loading && rows.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={intl.formatMessage({ id: "quality.case.empty" })}
      />
    );
  }

  return (
    <div>
      <List
        size="small"
        loading={loading}
        dataSource={rows}
        renderItem={(c) => {
          const rk = (c.result ?? "untested") as TestResult | "untested";
          return (
            <List.Item>
              <List.Item.Meta
                title={
                  <span>
                    <span
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        opacity: 0.6,
                      }}
                    >
                      {c.caseNo}
                    </span>{" "}
                    {c.title}
                  </span>
                }
              />
              <Tag
                color={TEST_RESULT_META[rk].color}
                style={{ marginInlineEnd: 0 }}
              >
                {intl.formatMessage({ id: TEST_RESULT_META[rk].i18nKey })}
              </Tag>
            </List.Item>
          );
        }}
      />
      <Button
        type="link"
        size="small"
        icon={<ArrowRightOutlined />}
        style={{ paddingInline: 0, marginTop: 8 }}
        onClick={() =>
          navigate(
            customerId
              ? `/quality/${customerId}?tab=cases`
              : "/quality?tab=cases"
          )
        }
      >
        {intl.formatMessage({ id: "quality.task.openInQuality" })}
      </Button>
    </div>
  );
}

/** タスクドロワー用：当該タスクに紐づくバグ一覧。既存バグの一括紐付けも可能。 */
export function TaskBugs({
  taskId,
  customerId,
}: {
  taskId: string;
  customerId?: string;
}) {
  const intl = useIntl();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [rows, setRows] = useState<Bug[]>([]);
  const [loading, setLoading] = useState(true);

  // 既存バグの一括紐付けピッカー
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<Bug[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(
    () =>
      listBugsByTask(taskId)
        .then((r) => setRows(r ?? []))
        .catch(() => setRows([]))
        .finally(() => setLoading(false)),
    [taskId]
  );

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  // ピッカーを開く：当該製品の全バグから、まだこのタスクに紐づいていないものを候補に。
  const openPicker = async () => {
    if (!customerId) return;
    setPicked([]);
    setPickerOpen(true);
    const all = await listBugsByCustomer(customerId).catch(() => []);
    const linked = new Set(rows.map((b) => b.id));
    setCandidates(
      (all ?? []).filter((b) => b.taskId !== taskId && !linked.has(b.id))
    );
  };

  const confirmLink = async () => {
    if (picked.length === 0) {
      setPickerOpen(false);
      return;
    }
    setSaving(true);
    try {
      const n = await batchLinkBugTask(picked, taskId);
      message.success(
        intl.formatMessage({ id: "quality.bug.batchLinkedN" }, { n })
      );
      setPickerOpen(false);
      await reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: 8,
        }}
      >
        <Button
          size="small"
          icon={<LinkOutlined />}
          onClick={openPicker}
          disabled={!customerId}
        >
          {intl.formatMessage({ id: "quality.bug.linkExisting" })}
        </Button>
      </div>

      {!loading && rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={intl.formatMessage({ id: "quality.bug.empty" })}
        />
      ) : (
        <List
          size="small"
          loading={loading}
          dataSource={rows}
          renderItem={(b) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <span>
                    <span
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        opacity: 0.6,
                      }}
                    >
                      {bugDisplayNo(b)}
                    </span>{" "}
                    {b.title}
                  </span>
                }
              />
              <Tag
                color={BUG_STATUS_META[b.status].color}
                style={{ marginInlineEnd: 0 }}
              >
                {intl.formatMessage({ id: BUG_STATUS_META[b.status].i18nKey })}
              </Tag>
            </List.Item>
          )}
        />
      )}

      <Button
        type="link"
        size="small"
        icon={<ArrowRightOutlined />}
        style={{ paddingInline: 0, marginTop: 8 }}
        onClick={() =>
          navigate(customerId ? `/quality/${customerId}` : "/quality")
        }
      >
        {intl.formatMessage({ id: "quality.task.openInQuality" })}
      </Button>

      <Modal
        open={pickerOpen}
        title={intl.formatMessage({ id: "quality.bug.linkExisting" })}
        onCancel={() => setPickerOpen(false)}
        onOk={confirmLink}
        okButtonProps={{ loading: saving, disabled: picked.length === 0 }}
        okText={intl.formatMessage(
          { id: "quality.bug.batchLinkN" },
          { n: picked.length }
        )}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <span style={{ opacity: 0.65 }}>
            {intl.formatMessage({ id: "quality.bug.linkExistingHint" })}
          </span>
          <Select
            mode="multiple"
            showSearch
            allowClear
            optionFilterProp="label"
            style={{ width: "100%" }}
            value={picked}
            onChange={setPicked}
            placeholder={intl.formatMessage({ id: "quality.bug.selectBugs" })}
            options={candidates.map((b) => ({
              value: b.id,
              label: `${bugDisplayNo(b)} ${b.title}`,
            }))}
            notFoundContent={intl.formatMessage({ id: "quality.bug.empty" })}
          />
        </Space>
      </Modal>
    </div>
  );
}

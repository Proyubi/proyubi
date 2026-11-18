// 思维导图编辑器页（/mindmaps/:id）：加载单图 → 全幅渲染 MindMapEditor。
import { LeftOutlined } from "@ant-design/icons";
import { useIntl, useNavigate, useParams } from "@umijs/max";
import { Button, Result, Spin } from "antd";
import { useEffect, useState } from "react";
import { getMindMap } from "@/pm/api";
import MindMapEditor from "@/pm/mindmap/MindMapEditor";
import type { MindMap } from "@/pm/types";

export default function MindMapEditPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const intl = useIntl();
  const t = (k: string) => intl.formatMessage({ id: k });

  const [map, setMap] = useState<MindMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    getMindMap(id)
      .then((m) => {
        if (alive) setMap(m);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <div style={{ padding: "12px 16px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <Button
          icon={<LeftOutlined />}
          size="small"
          onClick={() => nav("/mindmaps")}
        >
          {t("mindmap.act.back")}
        </Button>
        <span style={{ fontWeight: 600, fontSize: 16 }}>{map?.name}</span>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: 64 }}>
          <Spin />
        </div>
      ) : error || !map ? (
        <Result
          status="404"
          title={t("mindmap.notFound")}
          extra={
            <Button type="primary" onClick={() => nav("/mindmaps")}>
              {t("mindmap.act.back")}
            </Button>
          }
        />
      ) : (
        <MindMapEditor map={map} />
      )}
    </div>
  );
}

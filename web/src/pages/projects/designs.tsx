import { Navigate, useParams, useSearchParams } from '@umijs/max';

/**
 * 旧 URL（/projects/:id/designs）。デザインボードはプロジェクト画面のタブに移ったので、
 * ?open= / ?new= / ?taskId= を引き継いで ?tab=design へ転送する（pm-mcp の旧 appUrl・ブックマーク用）。
 */
export default function ProjectDesignsRedirect() {
  const { projectId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams();
  next.set('tab', 'design');
  for (const k of ['open', 'frame', 'taskId']) {
    const v = searchParams.get(k);
    if (v) next.set(k, v);
  }
  // 旧 ?new=1 は種類を持たないので業務フローボード（旧来の白板）として開く
  if (searchParams.get('new'))
    next.set('new', searchParams.get('new') === 'pen' ? 'pen' : 'excalidraw');
  return (
    <Navigate to={`/projects/${projectId}/gantt?${next.toString()}`} replace />
  );
}

import { useMemo } from 'react';
import type { Dependency } from '../types';
import { GANTT } from '../theme';
import { buildDepPaths, type GanttGeom } from './ganttLayout';

interface Props {
  deps: Dependency[];
  geom: GanttGeom;
  height: number;
  highlightIds?: Set<string>;
}

export default function DependencyLines({
  deps,
  geom,
  height,
  highlightIds,
}: Props) {
  const paths = useMemo(
    () => buildDepPaths(deps, geom, GANTT.rowHeight),
    [deps, geom],
  );

  return (
    <svg
      className="gt-deps"
      width={geom.contentWidth}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    >
      <defs>
        <marker
          id="gt-arrow"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill="#9aa3b2" />
        </marker>
        <marker
          id="gt-arrow-hl"
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill="#2f6bff" />
        </marker>
      </defs>
      {paths.map((p) => {
        if (!p.fromVisible || !p.d) return null;
        const dep = deps.find((x) => x.id === p.id) as Dependency;
        const hl =
          highlightIds &&
          (highlightIds.has(dep.predecessorId) ||
            highlightIds.has(dep.successorId));
        return (
          <path
            key={p.id}
            d={p.d}
            fill="none"
            stroke={hl ? '#2f6bff' : '#c2c9d6'}
            strokeWidth={hl ? 1.6 : 1.2}
            markerEnd={`url(#${hl ? 'gt-arrow-hl' : 'gt-arrow'})`}
          />
        );
      })}
    </svg>
  );
}

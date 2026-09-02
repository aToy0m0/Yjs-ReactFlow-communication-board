"use client";

import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath, getStraightPath, Position } from "@xyflow/react";

export type BoardEdgeData = { lineType: "straight" | "bezier" | "smoothstep"; locked: boolean };

const handleDirection: Record<Position, { x: number; y: number }> = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
};

function getBoardBezierPath(sourceX: number, sourceY: number, targetX: number, targetY: number, sourcePosition: Position, targetPosition: Position) {
  const sourceDirection = handleDirection[sourcePosition];
  const targetDirection = handleDirection[targetPosition];
  const horizontalHandles = sourceDirection.x !== 0 && targetDirection.x !== 0;
  const verticalHandles = sourceDirection.y !== 0 && targetDirection.y !== 0;
  const primaryDistance = horizontalHandles ? Math.abs(targetX - sourceX) : verticalHandles ? Math.abs(targetY - sourceY) : 0;
  const crossDistance = horizontalHandles ? Math.abs(targetY - sourceY) : verticalHandles ? Math.abs(targetX - sourceX) : Math.hypot(targetX - sourceX, targetY - sourceY);
  const sameSide = sourcePosition === targetPosition;
  const controlDistance = sameSide
    ? Math.min(220, Math.max(72, 56 + crossDistance * 0.35))
    : Math.min(180, Math.max(56, primaryDistance * 0.42 + crossDistance * 0.18));
  const sourceControlX = sourceX + sourceDirection.x * controlDistance;
  const sourceControlY = sourceY + sourceDirection.y * controlDistance;
  const targetControlX = targetX + targetDirection.x * controlDistance;
  const targetControlY = targetY + targetDirection.y * controlDistance;
  const labelX = (sourceX + 3 * sourceControlX + 3 * targetControlX + targetX) / 8;
  const labelY = (sourceY + 3 * sourceControlY + 3 * targetControlY + targetY) / 8;

  return [`M ${sourceX},${sourceY} C ${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`, labelX, labelY] as const;
}

export default function BoardEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerStart, markerEnd, style, label, selected, interactionWidth, data }: EdgeProps) {
  const edgeData = data as BoardEdgeData;
  const pathResult = edgeData.lineType === "straight"
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : edgeData.lineType === "bezier"
      ? getBoardBezierPath(sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition)
      : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const [path, labelX, labelY] = pathResult;

  return <>
    <BaseEdge id={id} path={path} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
    {selected && <g className="selected-edge-points" aria-hidden="true"><circle cx={sourceX} cy={sourceY} r="6" /><circle cx={targetX} cy={targetY} r="6" /></g>}
    {label && <EdgeLabelRenderer><span className={`edge-label ${selected ? "is-selected" : ""}`} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{String(label)}</span></EdgeLabelRenderer>}
  </>;
}

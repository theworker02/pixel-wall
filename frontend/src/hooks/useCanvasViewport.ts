import { useCallback, useRef, useState, type RefObject } from "react";
import { centeredTransform, clampPan, screenToWorld, worldToScreen, zoomTowardPoint, type Point, type ViewportTransform } from "../utils/canvasMath";

const DEFAULT_ZOOM = 1;

export function useCanvasViewport(viewport: RefObject<HTMLDivElement | null>, worldSize: number, onChange: () => void) {
  const transform = useRef<ViewportTransform>({ scale: DEFAULT_ZOOM, offsetX: 0, offsetY: 0 });
  const [scale, setScale] = useState(DEFAULT_ZOOM);
  const renderFrame = useRef<number | null>(null);

  const bounds = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect();
    return { width: rect?.width ?? 900, height: rect?.height ?? 620 };
  }, [viewport]);

  const scheduleRender = useCallback(() => {
    if (renderFrame.current !== null) return;
    renderFrame.current = requestAnimationFrame(() => {
      renderFrame.current = null;
      onChange();
    });
  }, [onChange]);

  const commit = useCallback((next: ViewportTransform) => {
    transform.current = clampPan(next, bounds(), worldSize);
    setScale(transform.current.scale);
    scheduleRender();
  }, [bounds, scheduleRender, worldSize]);

  const centerCanvas = useCallback((announceScale = transform.current.scale) => {
    commit(centeredTransform(bounds(), worldSize, announceScale));
  }, [bounds, commit, worldSize]);

  const resetView = useCallback(() => centerCanvas(DEFAULT_ZOOM), [centerCanvas]);
  const panBy = useCallback((delta: Point) => commit({ ...transform.current, offsetX: transform.current.offsetX + delta.x, offsetY: transform.current.offsetY + delta.y }), [commit]);
  const zoomAtPoint = useCallback((nextScale: number, point?: Point) => {
    const viewportSize = bounds();
    commit(zoomTowardPoint(transform.current, point ?? { x: viewportSize.width / 2, y: viewportSize.height / 2 }, nextScale));
  }, [bounds, commit]);
  const zoomIn = useCallback(() => zoomAtPoint(transform.current.scale * 1.25), [zoomAtPoint]);
  const zoomOut = useCallback(() => zoomAtPoint(transform.current.scale / 1.25), [zoomAtPoint]);
  const resetZoom = useCallback(() => zoomAtPoint(DEFAULT_ZOOM), [zoomAtPoint]);

  return {
    transform,
    scale,
    commit,
    centerCanvas,
    resetView,
    panBy,
    zoomAtPoint,
    zoomIn,
    zoomOut,
    resetZoom,
    screenToWorld: (point: Point) => screenToWorld(point, transform.current),
    worldToScreen: (point: Point) => worldToScreen(point, transform.current)
  };
}

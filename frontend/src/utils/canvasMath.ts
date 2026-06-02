export type Point = { x: number; y: number };
export type ViewportTransform = { scale: number; offsetX: number; offsetY: number };
export type ViewportSize = { width: number; height: number };

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 32;

export function clampZoom(scale: number) {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export function screenToWorld(point: Point, transform: ViewportTransform): Point {
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale
  };
}

export function worldToScreen(point: Point, transform: ViewportTransform): Point {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY
  };
}

export function clampPan(transform: ViewportTransform, viewport: ViewportSize, worldSize: number, margin = 96): ViewportTransform {
  const scaledSize = worldSize * transform.scale;
  const clampAxis = (offset: number, viewportSize: number) => {
    if (!Number.isFinite(offset)) return (viewportSize - scaledSize) / 2;
    if (scaledSize <= viewportSize) return (viewportSize - scaledSize) / 2;
    return Math.min(margin, Math.max(viewportSize - scaledSize - margin, offset));
  };
  return {
    ...transform,
    offsetX: clampAxis(transform.offsetX, viewport.width),
    offsetY: clampAxis(transform.offsetY, viewport.height)
  };
}

export function centeredTransform(viewport: ViewportSize, worldSize: number, scale: number): ViewportTransform {
  const nextScale = clampZoom(scale);
  return {
    scale: nextScale,
    offsetX: (viewport.width - worldSize * nextScale) / 2,
    offsetY: (viewport.height - worldSize * nextScale) / 2
  };
}

export function zoomTowardPoint(transform: ViewportTransform, screenPoint: Point, nextScale: number): ViewportTransform {
  const scale = clampZoom(nextScale);
  const world = screenToWorld(screenPoint, transform);
  return {
    scale,
    offsetX: screenPoint.x - world.x * scale,
    offsetY: screenPoint.y - world.y * scale
  };
}

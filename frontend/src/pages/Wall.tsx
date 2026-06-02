import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { io } from "socket.io-client";
import { Camera, Clipboard, Crosshair, Eraser, Flame, Grid3X3, Hand, History, LocateFixed, Minus, MousePointer2, Paintbrush, Plus, RotateCcw, Send, Sparkles, Trash2, ZoomIn } from "lucide-react";
import { Link } from "react-router-dom";
import { useCanvasViewport } from "../hooks/useCanvasViewport";
import { api, useAuth } from "../state";
import { socketOrigin } from "../config";

type Pixel = { x: number; y: number; color: string | null; createdAt?: string };
type HeatCell = { x: number; y: number; count: number };
type CanvasEntry = { originX: number; originY: number; size: number };
type RecentBatch = { batchId: string; userId: number; username: string; pixelCount: number; minX: number; minY: number; maxX: number; maxY: number; createdAt?: string; color: string; pixels: Array<{x:number;y:number}> };
type StrokeAssist = "smooth" | "line";
const SIZE = 8192;
const palette = ["#111827", "#ffffff", "#71717a", "#dc2626", "#fb7185", "#f97316", "#fb923c", "#facc15", "#4ade80", "#16a34a", "#22d3ee", "#0284c7", "#2563eb", "#818cf8", "#7c3aed", "#a78bfa", "#db2777", "#f472b6", "#78350f", "#f5d0a9"];
const challenges = ["Draw a tiny house", "Leave a blue constellation", "Add one pixel flower", "Draw a secret doorway", "Make a miniature star"];

export function Wall() {
  const { user } = useAuth();
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pixels = useRef(new Map<string, Pixel>());
  const pending = useRef(new Map<string, Pixel>());
  const entryRef = useRef<CanvasEntry | null>(null);
  const draftEntryRef = useRef<CanvasEntry | null>(null);
  const focusedBatchRef = useRef<RecentBatch | null>(null);
  const action = useRef<"panning" | "drawing" | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });
  const strokeStart = useRef<{ x: number; y: number } | null>(null);
  const strokeLast = useRef<{ x: number; y: number } | null>(null);
  const [recent, setRecent] = useState<RecentBatch[]>([]);
  const [stats, setStats] = useState<Array<{ color: string; count: number }>>([]);
  const [heat, setHeat] = useState<HeatCell[]>([]);
  const [mode, setMode] = useState<"live" | "heatmap" | "replay">("live");
  const [color, setColor] = useState("#22d3ee");
  const [tool, setTool] = useState<"navigate" | "draw" | "erase">("navigate");
  const [brush, setBrush] = useState(1);
  const [strokeAssist, setStrokeAssist] = useState<StrokeAssist>("smooth");
  const [showGrid, setShowGrid] = useState(true);
  const [entry, setEntry] = useState<CanvasEntry | null>(null);
  const [draftEntry, setDraftEntry] = useState<CanvasEntry | null>(null);
  const [focusedBatchId, setFocusedBatchId] = useState<string | null>(null);
  const [coord, setCoord] = useState({ x: 0, y: 0 });
  const [notice, setNotice] = useState("Explore freely. Log in when you want to leave a mark.");
  const [cooldown, setCooldown] = useState(0);
  const [replaying, setReplaying] = useState(false);
  const challenge = challenges[new Date().getDate() % challenges.length];
  const isNewAccount = user ? Date.now() - Date.parse(user.created_at) < 86_400_000 : false;
  const batchLimit = isNewAccount ? 16 : 64;
  const availableBrushes = isNewAccount ? [1, 2, 4] : [1, 2, 4, 8];
  const renderRef = useRef<() => void>(() => {});
  const requestRender = useCallback(() => renderRef.current(), []);
  const viewportState = useCanvasViewport(viewport, SIZE, requestRender);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const x = Number(params.get("x")), y = Number(params.get("y")), z = Number(params.get("z"));
    if (params.has("x") && params.has("y") && Number.isFinite(x) && Number.isFinite(y)) {
      const nextZoom = Number.isFinite(z) && z >= .25 && z <= 12 ? z : 1;
      viewportState.commit({ scale: nextZoom, offsetX: -x * nextZoom + 300, offsetY: -y * nextZoom + 220 });
    } else viewportState.resetView();
  }, []);

  const paint = useCallback((base = pixels.current) => {
    const element = canvas.current, bounds = viewport.current?.getBoundingClientRect();
    const ctx = element?.getContext("2d");
    if (!element || !bounds || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(bounds.width)), height = Math.max(1, Math.floor(bounds.height));
    if (element.width !== width * dpr || element.height !== height * dpr) {
      element.width = width * dpr; element.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
    const camera = viewportState.transform.current, cameraZoom = camera.scale;
    const drawPixel = (p: Pixel) => {
      const screenX = camera.offsetX + p.x * cameraZoom, screenY = camera.offsetY + p.y * cameraZoom;
      if (screenX + cameraZoom < 0 || screenY + cameraZoom < 0 || screenX > width || screenY > height) return;
      ctx.fillStyle = p.color ?? "#ffffff"; ctx.fillRect(screenX, screenY, cameraZoom, cameraZoom);
    };
    for (const p of base.values()) if (p.color) drawPixel(p);
    for (const p of pending.current.values()) drawPixel(p);
    if (mode === "heatmap" && heat.length) {
      const max = Math.max(...heat.map((c) => c.count));
      for (const c of heat) {
        ctx.fillStyle = `rgba(244,63,94,${Math.max(.12, c.count / max * .72)})`;
        ctx.fillRect(camera.offsetX + c.x * 32 * cameraZoom, camera.offsetY + c.y * 32 * cameraZoom, 32 * cameraZoom, 32 * cameraZoom);
      }
    }
    if (showGrid) {
      const step = cameraZoom >= 4 ? 1 : 32;
      const startX = Math.max(0, Math.floor(-camera.offsetX / cameraZoom / step) * step), endX = Math.min(SIZE, Math.ceil((width - camera.offsetX) / cameraZoom / step) * step);
      const startY = Math.max(0, Math.floor(-camera.offsetY / cameraZoom / step) * step), endY = Math.min(SIZE, Math.ceil((height - camera.offsetY) / cameraZoom / step) * step);
      ctx.beginPath(); ctx.strokeStyle = cameraZoom >= 4 ? "rgba(15, 23, 42, .32)" : "rgba(8, 145, 178, .16)"; ctx.lineWidth = 1;
      for (let x = startX; x <= endX; x += step) { const sx = Math.round(camera.offsetX + x * cameraZoom) + .5; ctx.moveTo(sx, 0); ctx.lineTo(sx, height); }
      for (let y = startY; y <= endY; y += step) { const sy = Math.round(camera.offsetY + y * cameraZoom) + .5; ctx.moveTo(0, sy); ctx.lineTo(width, sy); }
      ctx.stroke();
      const labelStep = cameraZoom >= 4 ? 32 : 128;
      const labelStartX = Math.max(0, Math.ceil(-camera.offsetX / cameraZoom / labelStep) * labelStep);
      const labelStartY = Math.max(0, Math.ceil(-camera.offsetY / cameraZoom / labelStep) * labelStep);
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace"; ctx.fillStyle = "rgba(8, 47, 73, .72)";
      for (let x = labelStartX; x <= endX; x += labelStep) ctx.fillText(String(x), camera.offsetX + x * cameraZoom + 4, 14);
      for (let y = labelStartY; y <= endY; y += labelStep) ctx.fillText(String(y), 4, camera.offsetY + y * cameraZoom - 4);
    }
    const plot = entryRef.current ?? draftEntryRef.current;
    if (plot) {
      ctx.fillStyle = "rgba(34, 211, 238, .05)";
      ctx.strokeStyle = "rgb(6, 182, 212)"; ctx.lineWidth = 2;
      ctx.fillRect(camera.offsetX + plot.originX * cameraZoom, camera.offsetY + plot.originY * cameraZoom, plot.size * cameraZoom, plot.size * cameraZoom);
      ctx.strokeRect(camera.offsetX + plot.originX * cameraZoom, camera.offsetY + plot.originY * cameraZoom, plot.size * cameraZoom, plot.size * cameraZoom);
    }
    const focused = focusedBatchRef.current;
    if (focused) {
      ctx.fillStyle = "rgba(37, 99, 235, .18)"; ctx.strokeStyle = "rgb(37, 99, 235)"; ctx.lineWidth = 2;
      for (const pixel of focused.pixels) {
        const x = camera.offsetX + pixel.x * cameraZoom, y = camera.offsetY + pixel.y * cameraZoom;
        ctx.fillRect(x, y, cameraZoom, cameraZoom); ctx.strokeRect(x, y, cameraZoom, cameraZoom);
      }
    }
  }, [heat, mode, showGrid]);
  renderRef.current = paint;

  useEffect(() => {
    api<{ pixels: Pixel[]; recent: RecentBatch[] }>("/api/canvas").then((data) => {
      pixels.current = new Map(data.pixels.map((p) => [`${p.x}:${p.y}`, p])); setRecent(data.recent); paint();
    });
    api<{ colors: Array<{ color: string; count: number }> }>("/api/stats/colors").then((r) => setStats(r.colors));
    const socket = io(socketOrigin || undefined);
    socket.on("pixels:placed", (batch: Pixel[]) => {
      batch.forEach((p) => p.color ? pixels.current.set(`${p.x}:${p.y}`, p) : pixels.current.delete(`${p.x}:${p.y}`));
      const painted = batch.filter((p) => p.color);
      if (painted.length) {
        const first = painted[0] as Pixel & { batchId: string; userId: number; username: string };
        setRecent((old) => [{ batchId:first.batchId,userId:first.userId,username:first.username,pixelCount:painted.length,minX:Math.min(...painted.map(p=>p.x)),minY:Math.min(...painted.map(p=>p.y)),maxX:Math.max(...painted.map(p=>p.x)),maxY:Math.max(...painted.map(p=>p.y)),color:first.color!,createdAt:new Date().toISOString(),pixels:painted.map(({x,y})=>({x,y})) }, ...old.filter((item) => item.batchId !== first.batchId)].slice(0,12));
      }
      paint();
    });
    socket.on("pixels:undone", (batch: Array<Pixel & { color: string | null }>) => {
      batch.forEach((p) => p.color ? pixels.current.set(`${p.x}:${p.y}`, p as Pixel) : pixels.current.delete(`${p.x}:${p.y}`)); paint();
    });
    return () => { socket.disconnect(); };
  }, [paint]);
  useEffect(() => {
    if (!user) {
      entryRef.current = null; draftEntryRef.current = null; setEntry(null); setDraftEntry(null); return;
    }
    api<{ entry: CanvasEntry | null }>("/api/canvas/entry").then(({ entry }) => {
      entryRef.current = entry; setEntry(entry); paint();
    });
  }, [user, paint]);

  useEffect(() => { if (mode === "heatmap" && !heat.length) api<{ cells: HeatCell[] }>("/api/stats/heatmap").then((r) => setHeat(r.cells)); paint(); }, [mode, heat.length, paint]);
  useEffect(() => { paint(); }, [paint, heat]);
  useEffect(() => {
    const observer = new ResizeObserver(() => paint());
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [paint]);
  useEffect(() => { if (!cooldown) return; const timer = setInterval(() => setCooldown((n) => Math.max(0, n - 100)), 100); return () => clearInterval(timer); }, [cooldown]);

  const screenPoint = (event: ReactPointerEvent | ReactWheelEvent) => {
    const rect = viewport.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const point = (event: ReactPointerEvent) => {
    const world = viewportState.screenToWorld(screenPoint(event));
    return { x: Math.floor(world.x), y: Math.floor(world.y) };
  };
  const previewAt = (x: number, y: number, render = true) => {
    if (!user || mode !== "live") return;
    const plot = entryRef.current ?? draftEntryRef.current ?? { originX: Math.floor(x / 32) * 32, originY: Math.floor(y / 32) * 32, size: 32 };
    if (!entryRef.current && !draftEntryRef.current) {
      draftEntryRef.current = plot; setDraftEntry(plot);
    }
    for (let dx = 0; dx < brush; dx++) for (let dy = 0; dy < brush; dy++) {
      if (pending.current.size >= batchLimit) {
        setNotice(`Preview full. Release to save this ${batchLimit}-pixel batch.`);
        return false;
      }
      if (x + dx >= plot.originX && y + dy >= plot.originY && x + dx < plot.originX + plot.size && y + dy < plot.originY + plot.size) {
        const pixel = { x: x + dx, y: y + dy, color: tool === "erase" ? null : color };
        pending.current.set(`${pixel.x}:${pixel.y}`, pixel);
      }
    }
    if (render) paint();
    return true;
  };
  const linePoints = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const points: Array<{ x: number; y: number }> = [];
    let x = from.x, y = from.y;
    const dx = Math.abs(to.x - x), sx = x < to.x ? 1 : -1;
    const dy = -Math.abs(to.y - y), sy = y < to.y ? 1 : -1;
    let error = dx + dy;
    while (true) {
      points.push({ x, y });
      if (x === to.x && y === to.y) break;
      const doubledError = 2 * error;
      if (doubledError >= dy) { error += dy; x += sx; }
      if (doubledError <= dx) { error += dx; y += sy; }
    }
    return points;
  };
  const previewStroke = (next: { x: number; y: number }) => {
    const from = strokeAssist === "line" ? strokeStart.current : strokeLast.current;
    if (!from) return;
    if (strokeAssist === "line") pending.current.clear();
    for (const p of linePoints(from, next)) if (previewAt(p.x, p.y, false) === false) break;
    strokeLast.current = next;
    paint();
  };
  const pointerDown = (event: ReactPointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    lastPointer.current = { x: event.clientX, y: event.clientY };
    if (event.button === 1 || event.button === 2 || event.shiftKey || tool === "navigate" || !user) {
      action.current = "panning"; return;
    }
    action.current = "drawing";
    const p = point(event);
    strokeStart.current = p; strokeLast.current = p;
    previewStroke(p);
  };
  const pointerMove = (event: ReactPointerEvent) => {
    const p = point(event); setCoord(p);
    if (action.current === "panning") viewportState.panBy({ x: event.clientX - lastPointer.current.x, y: event.clientY - lastPointer.current.y });
    else if (action.current === "drawing") previewStroke(p);
    lastPointer.current = { x: event.clientX, y: event.clientY };
  };
  const flush = async (event?: ReactPointerEvent) => {
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const finishedAction = action.current;
    action.current = null;
    strokeStart.current = null; strokeLast.current = null;
    if (finishedAction !== "drawing") return;
    const batch = [...pending.current.values()];
    if (!batch.length) return;
    try {
      const result = await api<{ cooldownMs: number; entry: CanvasEntry }>("/api/canvas/pixels", { method: "POST", body: JSON.stringify({ pixels: batch.map((pixel) => pixel.color ? pixel : { x: pixel.x, y: pixel.y, erase: true }) }) });
      pending.current.clear(); setCooldown(result.cooldownMs); setNotice(`${batch.length} pixels ${tool === "erase" ? "erased from" : "added to"} the wall.`);
      entryRef.current = result.entry; draftEntryRef.current = null; setEntry(result.entry); setDraftEntry(null);
    } catch (error) {
      pending.current.clear();
      if (!entryRef.current) { draftEntryRef.current = null; setDraftEntry(null); }
      setNotice(`${(error as Error).message} Your unpublished preview was cleared.`);
    }
    paint();
  };
  const clearPreview = () => { pending.current.clear(); if (!entryRef.current) { draftEntryRef.current = null; setDraftEntry(null); } paint(); setNotice("Unpublished preview cleared."); };
  const undo = async () => {
    try { await api("/api/canvas/undo", { method: "POST" }); setNotice("Your latest visible batch was undone."); }
    catch (error) { setNotice((error as Error).message); }
  };
  const copyLocation = async () => { const url = `${location.origin}/?x=${coord.x}&y=${coord.y}&z=${viewportState.scale.toFixed(2)}`; await navigator.clipboard.writeText(url); setNotice("Canvas location copied."); };
  const randomArea = () => {
    let x = 0, y = 0;
    for (let tries = 0; tries < 100; tries++) {
      x = Math.floor(Math.random() * (SIZE - 400)); y = Math.floor(Math.random() * (SIZE - 300));
      if (![...pixels.current.values()].some((p) => p.x >= x && p.x < x + 120 && p.y >= y && p.y < y + 90)) break;
    }
    viewportState.commit({ scale: viewportState.transform.current.scale, offsetX: -x * viewportState.transform.current.scale + 130, offsetY: -y * viewportState.transform.current.scale + 100 }); setNotice(`Found open space near ${x}, ${y}.`);
  };
  const focusBatch = (batch: RecentBatch) => {
    const rect = viewport.current?.getBoundingClientRect();
    const scale = 8, centerX = (batch.minX + batch.maxX + 1) / 2, centerY = (batch.minY + batch.maxY + 1) / 2;
    focusedBatchRef.current = batch; setFocusedBatchId(batch.batchId);
    viewportState.commit({ scale, offsetX:(rect?.width??900)/2-centerX*scale, offsetY:(rect?.height??620)/2-centerY*scale });
    setNotice(`Focused on @${batch.username}'s recent placement near ${batch.minX}, ${batch.minY}.`);
  };
  const screenshot = () => {
    const exportCanvas = document.createElement("canvas"); exportCanvas.width = SIZE; exportCanvas.height = SIZE;
    const ctx = exportCanvas.getContext("2d")!; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, SIZE, SIZE);
    for (const pixel of pixels.current.values()) if (pixel.color) { ctx.fillStyle = pixel.color; ctx.fillRect(pixel.x, pixel.y, 1, 1); }
    const link = document.createElement("a"); link.download = "free-pixel-wall.png"; link.href = exportCanvas.toDataURL("image/png"); link.click();
  };
  const replay = async () => {
    if (replaying) return;
    setMode("replay"); setReplaying(true); pending.current.clear();
    const { pixels: history } = await api<{ pixels: Pixel[] }>("/api/replay");
    const frame = new Map<string, Pixel>(); let index = 0;
    const timer = setInterval(() => {
      history.slice(index, index + 90).forEach((p) => p.color ? frame.set(`${p.x}:${p.y}`, p) : frame.delete(`${p.x}:${p.y}`)); index += 90; paint(frame);
      if (index >= history.length) { clearInterval(timer); setReplaying(false); setNotice("Replay complete. Switch back to Live to draw."); }
    }, 35);
  };
  const wheelZoom = (event: ReactWheelEvent) => {
    event.preventDefault();
    viewportState.zoomAtPoint(viewportState.transform.current.scale * (event.deltaY > 0 ? .9 : 1.1), screenPoint(event));
  };
  const selectTool = (next: typeof tool) => setTool((current) => current === next && next !== "navigate" ? "navigate" : next);

  return <main className="grid-glow min-h-[calc(100vh-64px)] overflow-x-hidden px-3 py-4 sm:px-4 sm:py-5">
    <div className="mx-auto max-w-[1550px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4 px-1">
        <div><p className="mb-1 text-xs font-bold uppercase tracking-[.22em] text-cyan-300">Live public canvas</p><h1 className="soft-title text-2xl font-black sm:text-3xl">One wall. Infinite tiny decisions.</h1></div>
        <div className="flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/6 px-4 py-2 text-xs text-cyan-200"><span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300"/> Wall is live</div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[230px_minmax(0,1fr)_260px]">
        <aside className="glass order-2 rounded-2xl p-4 xl:order-1">
          <PanelTitle icon={<MousePointer2 size={14}/>} text="Drawing kit"/>
          <label className="mt-5 block text-xs text-zinc-500">Tool</label>
          <div className="mt-2 grid grid-cols-3 gap-2"><Tool active={tool==="navigate"} icon={<Hand size={14}/>} text="Navigate" onClick={()=>selectTool("navigate")}/><Tool active={tool==="draw"} icon={<Paintbrush size={14}/>} text="Draw" onClick={()=>selectTool("draw")}/><Tool active={tool==="erase"} icon={<Eraser size={14}/>} text="Erase" onClick={()=>selectTool("erase")}/></div>
          <label className="mt-5 block text-xs text-zinc-500">Selected color</label>
          <div className={`mt-2 flex items-center gap-2 ${tool==="erase"?"opacity-40":""}`}><input type="color" value={color} onChange={(e) => {setColor(e.target.value);setTool("draw")}} className="h-10 w-12 rounded bg-transparent"/><code className="text-sm text-zinc-300">{color}</code></div>
          <div className="mt-3 grid grid-cols-5 gap-2">{palette.map((c) => <button key={c} onClick={() => {setColor(c);setTool("draw")}} title={c} className={`h-7 rounded-md border ${tool==="draw"&&color === c ? "scale-110 border-white" : "border-white/10"}`} style={{background:c}}/>)}</div>
          <label className="mt-6 block text-xs text-zinc-500">Brush size</label>
          <div className="mt-2 grid grid-cols-4 gap-2">{availableBrushes.map((b) => <button key={b} onClick={() => setBrush(b)} className={`rounded-lg py-2 text-xs font-bold ${brush === b ? "bg-cyan-400 text-slate-950" : "bg-white/5 text-zinc-400 hover:bg-white/10"}`}>{b}px</button>)}</div>
          {isNewAccount&&<p className="mt-2 text-[11px] leading-4 text-zinc-600">New accounts unlock the 8px brush after 24 hours.</p>}
          <label className="mt-5 block text-xs text-zinc-500" htmlFor="stroke-assist">Stroke assist</label>
          <select id="stroke-assist" value={strokeAssist} onChange={(event) => setStrokeAssist(event.target.value as StrokeAssist)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#111827] px-3 py-2.5 text-xs font-bold text-zinc-300 outline-none focus:border-cyan-400/70">
            <option value="smooth">Smooth freehand</option>
            <option value="line">Straight line</option>
          </select>
          <p className="mt-2 text-[11px] leading-4 text-zinc-600">{strokeAssist === "line" ? "Drag from one point to another to preview a straight pixel line." : "Drag naturally. Gaps between pointer samples are filled automatically."}</p>
          <div className="mt-5 rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-3 text-[11px] leading-5 text-zinc-400">{entry ? <>Your single entry is the outlined <b className="text-cyan-300">32 x 32</b> plot at {entry.originX}, {entry.originY}.</> : <>Your first published pixel claims one <b className="text-cyan-300">32 x 32</b> plot. You can keep editing inside it.</>}</div>
          <div className="mt-6 space-y-2">
            <Action icon={<Trash2 size={14}/>} text="Clear preview" onClick={clearPreview}/>
            <Action icon={<RotateCcw size={14}/>} text="Undo latest batch" onClick={undo}/>
          </div>
          <div className="mt-5 rounded-xl bg-white/4 p-3 text-xs leading-5 text-zinc-400">{user ? <><b className="text-zinc-200">@{user.username}</b><br/>Use Navigate to explore. Use Draw or Erase inside your plot.</> : <>Viewing as guest. Drag to explore.<br/><Link to="/login" className="font-bold text-cyan-300">Log in to place pixels.</Link></>}</div>
        </aside>
        <section className="glass order-1 overflow-hidden rounded-2xl xl:order-2">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/7 p-2 sm:p-3">
            <Mode active={mode==="live"} onClick={() => setMode("live")} text="Live"/>
            <Mode active={mode==="heatmap"} onClick={() => setMode("heatmap")} text="Heatmap" icon={<Flame size={13}/>}/>
            <Mode active={mode==="replay"} onClick={replay} text={replaying ? "Replaying..." : "Pixel Replay"} icon={<History size={13}/>}/>
            <span className="mx-1 h-5 border-l border-white/10"/>
            <Mode active={showGrid} onClick={() => setShowGrid((visible) => !visible)} text="Grid" icon={<Grid3X3 size={13}/>}/>
            <IconButton onClick={viewportState.zoomOut} label="Zoom out"><Minus size={15}/></IconButton><span className="w-12 text-center text-xs text-zinc-400">{Math.round(viewportState.scale*100)}%</span><IconButton onClick={viewportState.zoomIn} label="Zoom in"><Plus size={15}/></IconButton>
            <IconButton onClick={viewportState.resetZoom} label="Reset zoom"><ZoomIn size={15}/></IconButton>
            <IconButton onClick={() => {viewportState.centerCanvas();setNotice("Centered on the middle of the canvas.")}} label="Center canvas"><Crosshair size={15}/></IconButton>
            <IconButton onClick={() => {viewportState.resetView();setNotice("Canvas view reset.")}} label="Reset view"><RotateCcw size={15}/></IconButton>
            <span className="hidden flex-1 sm:block"/>
            <IconButton onClick={randomArea} label="Random empty area"><LocateFixed size={15}/></IconButton>
            <IconButton onClick={copyLocation} label="Copy location link"><Clipboard size={15}/></IconButton>
            <IconButton onClick={screenshot} label="Export screenshot"><Camera size={15}/></IconButton>
          </div>
          <div ref={viewport} className={`relative h-[58vh] min-h-[360px] max-h-[620px] touch-none overflow-hidden bg-[#0d111b] sm:h-[620px] ${tool==="navigate"||!user?"cursor-grab active:cursor-grabbing":"cursor-crosshair"}`} onWheel={wheelZoom} onContextMenu={(e) => e.preventDefault()} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={flush} onPointerCancel={flush} onPointerLeave={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) action.current = null; }}>
            <canvas ref={canvas} className="pixel-canvas pointer-events-none absolute inset-0 h-full w-full shadow-[0_0_90px_#22d3ee24]"/>
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/70 px-3 py-2 font-mono text-xs text-zinc-300">x {coord.x} / y {coord.y}</div>
          </div>
          <div className="flex items-center gap-3 border-t border-white/7 px-4 py-3 text-xs text-zinc-500"><Send size={13} className="text-cyan-400"/><span>{notice}</span>{cooldown > 0 && <span className="ml-auto text-amber-300">cooldown {(cooldown/1000).toFixed(1)}s</span>}</div>
        </section>
        <aside className="glass order-3 rounded-2xl p-4">
          <PanelTitle icon={<Sparkles size={14}/>} text="Daily challenge"/>
          <p className="mt-3 text-sm font-semibold text-zinc-200">{challenge}</p><p className="mt-1 text-xs leading-5 text-zinc-500">No prizes. Just leave the wall stranger than you found it.</p>
          <PanelTitle icon={<Flame size={14}/>} text="Top colors" extra="mt-7"/>
          <div className="mt-3 space-y-2">{stats.length ? stats.map((s) => <div key={s.color} className="flex items-center gap-2 text-xs"><i className="h-3 w-3 rounded-sm" style={{background:s.color}}/><span className="text-zinc-400">{s.color}</span><b className="ml-auto text-zinc-300">{s.count}</b></div>) : <p className="text-xs text-zinc-600">The wall is waiting.</p>}</div>
          <PanelTitle icon={<Crosshair size={14}/>} text="Recently placed" extra="mt-7"/>
          <div className="scrollbar mt-3 max-h-56 space-y-2 overflow-auto">{recent.map((batch) => <button key={batch.batchId} onClick={()=>focusBatch(batch)} aria-label={`Focus ${batch.username}'s placement near ${batch.minX}, ${batch.minY}`} className={`block w-full rounded-lg px-2.5 py-2 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-blue-400/80 ${focusedBatchId===batch.batchId?"bg-blue-500/15 ring-1 ring-blue-400/70":"bg-white/3 hover:bg-white/7"}`}><div className="flex items-center gap-2"><i className="h-3 w-3 rounded-sm" style={{background:batch.color}}/><b className="truncate text-zinc-300">@{batch.username}</b><span className="ml-auto shrink-0 text-zinc-600">{batch.createdAt?.slice(11,16) ?? "now"}</span></div><p className="mt-1 text-[11px] text-zinc-500">{batch.pixelCount} pixel{batch.pixelCount===1?"":"s"} near {batch.minX}, {batch.minY}</p></button>)}{!recent.length&&<p className="text-xs text-zinc-600">No placements yet.</p>}</div>
        </aside>
      </div>
    </div>
  </main>;
}
function PanelTitle({icon,text,extra=""}:{icon:React.ReactNode;text:string;extra?:string}) { return <h2 className={`flex items-center gap-2 text-xs font-black uppercase tracking-[.16em] text-zinc-400 ${extra}`}>{icon}{text}</h2>; }
function Action({icon,text,onClick}:{icon:React.ReactNode;text:string;onClick:()=>void}) { return <button onClick={onClick} className="flex w-full items-center gap-2 rounded-lg bg-white/5 px-3 py-2.5 text-left text-xs text-zinc-300 hover:bg-white/10">{icon}{text}</button>; }
function Tool({active,icon,text,onClick}:{active:boolean;icon:React.ReactNode;text:string;onClick:()=>void}) { return <button onClick={onClick} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] font-bold leading-none ${active?"bg-cyan-400 text-slate-950":"bg-white/5 text-zinc-400 hover:bg-white/10"}`}><span className="grid h-4 place-items-center">{icon}</span><span className="block w-full truncate text-center">{text}</span></button>; }
function Mode({active,onClick,text,icon}:{active:boolean;onClick:()=>void;text:string;icon?:React.ReactNode}) { return <button onClick={onClick} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${active?"bg-cyan-400 text-slate-950":"bg-white/5 text-zinc-400 hover:bg-white/10"}`}>{icon}{text}</button>; }
function IconButton({children,label,onClick}:{children:React.ReactNode;label:string;onClick:()=>void}) { return <button onClick={onClick} aria-label={label} title={label} className="rounded-lg bg-white/5 p-2 text-zinc-300 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/70">{children}</button>; }

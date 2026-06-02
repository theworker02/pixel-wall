import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Activity, CalendarDays, Clock3, Flame, Palette, Sparkles } from "lucide-react";
import { api } from "../state";

type ProfileData={id:number;username:string;joinDate:string;lastActive:string;totalPixels:number;weeklyPixels:number;firstPixel:string|null;favoriteColor:string;drawingStreak:number};
type Pixel={x:number;y:number;color:string;createdAt?:string};

export function Profile(){
  const {id}=useParams(); const [profile,setProfile]=useState<ProfileData|null>(null); const [preview,setPreview]=useState<Pixel[]>([]); const [activity,setActivity]=useState<Pixel[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState(""); const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{setLoading(true);setError("");Promise.all([api<{profile:ProfileData;preview:Pixel[]}>(`/api/users/${id}/profile`),api<{activity:Pixel[]}>(`/api/users/${id}/activity`)]).then(([details,recent])=>{setProfile(details.profile);setPreview(details.preview);setActivity(recent.activity)}).catch(err=>setError((err as Error).message)).finally(()=>setLoading(false));},[id]);
  useEffect(()=>{const ctx=canvas.current?.getContext("2d");if(!ctx)return;ctx.fillStyle="#10131c";ctx.fillRect(0,0,280,180);if(!preview.length)return;const minX=Math.min(...preview.map(p=>p.x)),minY=Math.min(...preview.map(p=>p.y));preview.forEach(p=>{ctx.fillStyle=p.color;ctx.fillRect((p.x-minX)%140*2,(p.y-minY)%90*2,2,2)});},[preview]);
  if(loading)return <main className="grid-glow min-h-screen p-12 text-center text-zinc-500">Loading profile...</main>;
  if(error||!profile)return <main className="grid-glow min-h-screen p-12 text-center text-rose-300">Could not load this profile: {error||"Profile not found."}</main>;
  return <main className="grid-glow min-h-[calc(100vh-64px)] px-5 py-12"><div className="mx-auto max-w-6xl">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.22em] text-cyan-300">Contributor profile</p><h1 className="soft-title mt-2 text-4xl font-black">@{profile.username}</h1><p className="mt-2 text-sm text-zinc-500">Joined {fmt(profile.joinDate)} / Last seen {fmt(profile.lastActive)}</p></div><i className="h-14 w-14 rounded-2xl border border-white/10 shadow-[0_0_30px_#ffffff22]" style={{background:profile.favoriteColor}}/></div>
    <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat icon={<Sparkles/>} label="Pixels placed" value={profile.totalPixels}/><Stat icon={<Activity/>} label="This week" value={profile.weeklyPixels}/><Stat icon={<Flame/>} label="Drawing days" value={profile.drawingStreak}/><Stat icon={<Palette/>} label="Favorite color" value={profile.favoriteColor}/></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.15fr]"><section className="glass rounded-2xl p-5"><h2 className="font-black">Recent pixel art</h2><p className="mt-1 text-xs text-zinc-500">A compact view of this contributor's latest marks.</p><canvas ref={canvas} width="280" height="180" className="mt-5 h-64 w-full rounded-xl bg-[#10131c] [image-rendering:pixelated]"/>{!preview.length&&<p className="-mt-36 text-center text-xs text-zinc-500">No pixel art yet.</p>}</section>
    <section className="glass rounded-2xl p-5"><h2 className="font-black">Recent activity</h2><div className="scrollbar mt-4 max-h-64 space-y-2 overflow-auto">{activity.map((p,i)=><div key={i} className="flex items-center gap-3 rounded-lg bg-white/3 px-3 py-2 text-xs"><i className="h-3 w-3 rounded-sm" style={{background:p.color}}/><span className="font-mono text-zinc-300">{p.x}, {p.y}</span><span className="ml-auto text-zinc-600">{fmt(p.createdAt!)}</span></div>)}{!activity.length&&<p className="rounded-lg bg-white/3 px-3 py-4 text-center text-xs text-zinc-500">No drawing activity yet.</p>}</div></section></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><Small icon={<CalendarDays/>} label="Join date" value={fmt(profile.joinDate)}/><Small icon={<Clock3/>} label="First pixel" value={profile.firstPixel?fmt(profile.firstPixel):"Not placed yet"}/><Small icon={<Activity/>} label="Last active" value={fmt(profile.lastActive)}/></div>
  </div></main>
}
const fmt=(v:string)=>new Date(`${v}Z`).toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric"});
function Stat({icon,label,value}:{icon:React.ReactNode;label:string;value:string|number}){return <div className="glass rounded-2xl p-4"><span className="text-cyan-300">{icon}</span><p className="mt-5 text-xs uppercase tracking-widest text-zinc-500">{label}</p><b className="mt-1 block text-xl">{value}</b></div>}
function Small({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){return <div className="glass flex items-center gap-3 rounded-xl p-4"><span className="text-cyan-300">{icon}</span><div><p className="text-xs text-zinc-500">{label}</p><b className="text-sm">{value}</b></div></div>}

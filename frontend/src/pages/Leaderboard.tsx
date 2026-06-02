import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, Palette, Sparkles, Trophy } from "lucide-react";
import { api } from "../state";

type Row = { id:number; username:string; pixelsPlaced:number; favoriteColor:string; lastActive:string; joinDate:string };
const tabs = [["all-time","All time"],["weekly","This week"],["newest","Newest users"],["colors","Color explorers"],["streaks","Drawing streaks"]];
export function Leaderboard() {
  const [tab,setTab]=useState("all-time"); const [rows,setRows]=useState<Row[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
  useEffect(()=>{ setLoading(true);setError("");api<{users:Row[]}>(`/api/leaderboard/${tab}`).then(r=>setRows(r.users)).catch(err=>setError((err as Error).message)).finally(()=>setLoading(false)); },[tab]);
  return <main className="grid-glow min-h-[calc(100vh-64px)] px-5 py-12"><div className="mx-auto w-full max-w-6xl">
    <p className="text-xs font-bold uppercase tracking-[.22em] text-cyan-300">Contribution index</p>
    <h1 className="soft-title mt-2 text-4xl font-black">The wall remembers.</h1>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Every placement counts, including the ones that were later painted over. This is a record of participation, not territory.</p>
    <div className="mt-8 flex flex-wrap gap-2">{tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} aria-pressed={tab===id} className={`rounded-full px-4 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-cyan-300/70 ${tab===id?"bg-cyan-400 text-slate-950":"glass text-zinc-400 hover:text-white"}`}>{label}</button>)}</div>
    <div className="glass mt-4 overflow-hidden rounded-2xl">
      <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm">
        <thead className="border-b border-white/7 bg-white/3 text-[11px] uppercase tracking-[.14em] text-zinc-500"><tr><th className="px-5 py-4">Rank</th><th>Username</th><th>Pixels placed</th><th>Favorite color</th><th>Last active</th><th>Join date</th></tr></thead>
        <tbody>{rows.map((r,i)=><tr key={r.id} className="border-b border-white/5 text-zinc-400 hover:bg-white/3">
          <td className="px-5 py-4 font-black text-zinc-300">{i===0?<Crown className="text-amber-300" size={17}/>:String(i+1).padStart(2,"0")}</td>
          <td><Link to={`/profile/${r.id}`} className="font-bold text-zinc-100 hover:text-cyan-300">@{r.username}</Link></td>
          <td className="font-mono text-cyan-300">{r.pixelsPlaced}</td>
          <td><span className="flex items-center gap-2"><i className="h-4 w-4 rounded" style={{background:r.favoriteColor}}/>{r.favoriteColor}</span></td>
          <td>{date(r.lastActive)}</td><td>{date(r.joinDate)}</td>
        </tr>)}</tbody>
      </table></div>
      {loading&&<div className="p-12 text-center text-sm text-zinc-500">Loading leaderboard...</div>}
      {!loading&&error&&<div className="p-12 text-center text-sm text-rose-300">Could not load the leaderboard: {error}</div>}
      {!loading&&!error&&!rows.length&&<div className="p-12 text-center text-sm text-zinc-500"><Sparkles className="mx-auto mb-3 text-cyan-400" size={22}/>No placements in this category yet.</div>}
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><Badge icon={<Trophy/>} text="Placement credit stays with you"/><Badge icon={<Palette/>} text="Overdraw keeps full history"/><Badge icon={<Sparkles/>} text="No paid pixels. Ever."/></div>
  </div></main>;
}
const date=(v:string)=>v?new Date(`${v}Z`).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"-";
function Badge({icon,text}:{icon:React.ReactNode;text:string}){return <div className="glass flex items-center gap-3 rounded-xl px-4 py-3 text-xs text-zinc-400"><span className="text-cyan-300">{icon}</span>{text}</div>}

import { useEffect, useState, type FormEvent } from "react";
import { FileText, LockKeyhole, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../state";

type Appeal = { id: number; receipt?: string; status: string; recommendation?: string | null; confidence?: number | null; rationale?: string | null; createdAt?: string; reviewedAt?: string | null };

export function AppealPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [statement, setStatement] = useState("");
  const [appeal, setAppeal] = useState<Appeal | null>(() => {
    const stored = localStorage.getItem("pixel-wall-appeal");
    return stored ? JSON.parse(stored) as Appeal : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    if (!appeal?.receipt) return;
    try {
      const result = await api<{ appeal: Appeal }>(`/api/appeals/${appeal.id}`, { headers: { "X-Appeal-Receipt": appeal.receipt } });
      const next = { ...result.appeal, receipt: appeal.receipt };
      setAppeal(next); localStorage.setItem("pixel-wall-appeal", JSON.stringify(next));
    } catch (err) { setError((err as Error).message); }
  };
  useEffect(() => { if (appeal?.status === "pending") { const timer = setInterval(refresh, 2500); return () => clearInterval(timer); } }, [appeal?.id, appeal?.status, appeal?.receipt]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<{ appeal: Appeal }>("/api/appeals", { method: "POST", body: JSON.stringify({ identifier, password, statement }) });
      setAppeal(result.appeal); localStorage.setItem("pixel-wall-appeal", JSON.stringify(result.appeal)); setPassword("");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const startOver = () => { localStorage.removeItem("pixel-wall-appeal"); setAppeal(null); setError(""); };

  return <main className="grid-glow min-h-[calc(100vh-64px)] px-5 py-12">
    <div className="mx-auto max-w-2xl">
      <p className="text-xs font-black uppercase tracking-[.2em] text-cyan-300">Moderation appeal</p>
      <h1 className="mt-3 text-3xl font-black sm:text-4xl">Ask for a second review.</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500">Appeals are free. Explain what happened and why restored access is appropriate. Gemini can prepare a recommendation, but a moderator makes the final decision.</p>
      <section className="glass mt-8 rounded-3xl p-6 sm:p-7">
        {appeal ? <AppealStatus appeal={appeal} refresh={refresh} startOver={startOver}/> : <form onSubmit={submit} className="space-y-4">
          <label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500"><Mail size={14}/>Email or username</span><input autoFocus value={identifier} onChange={(event)=>setIdentifier(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-cyan-400/60" required/></label>
          <label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500"><LockKeyhole size={14}/>Password</span><input type="password" value={password} onChange={(event)=>setPassword(event.target.value)} maxLength={128} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-cyan-400/60" required/></label>
          <label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500"><FileText size={14}/>Your appeal</span><textarea value={statement} onChange={(event)=>setStatement(event.target.value)} minLength={30} maxLength={1500} rows={7} placeholder="Explain the context, acknowledge any mistake, and describe how you will follow the rules." className="w-full resize-y rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 outline-none focus:border-cyan-400/60" required/><span className="mt-1 block text-right text-[11px] text-zinc-600">{statement.length} / 1500</span></label>
          {error&&<p className="rounded-lg bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
          <button disabled={busy} className="w-full rounded-xl bg-cyan-400 py-3 text-sm font-black text-slate-950 hover:bg-cyan-300 disabled:opacity-50">{busy?"Submitting...":"Submit appeal"}</button>
        </form>}
      </section>
    </div>
  </main>;
}

function AppealStatus({ appeal, refresh, startOver }: { appeal: Appeal; refresh: () => void; startOver: () => void }) {
  const done = appeal.status === "restored" || appeal.status === "denied";
  const copy = appeal.status === "restored" ? "Your access has been restored. Sign in again to use your plot." : appeal.status === "denied" ? "Your appeal was denied. Access remains restricted." : appeal.status === "pending" ? "Your appeal is being evaluated." : "Your appeal has been evaluated and is waiting for a moderator.";
  return <div>
    <ShieldCheck className="text-cyan-300" size={34}/>
    <p className="mt-5 text-xs font-black uppercase tracking-[.18em] text-cyan-300">Appeal #{appeal.id}</p>
    <h2 className="mt-2 text-2xl font-black capitalize">{appeal.status.replace(/_/g," ")}</h2>
    <p className="mt-3 text-sm leading-6 text-zinc-400">{copy}</p>
    {appeal.rationale&&<p className="mt-4 rounded-xl border border-white/8 bg-white/4 p-3 text-xs leading-5 text-zinc-500">{appeal.rationale}</p>}
    <div className="mt-6 flex flex-wrap gap-2"><button onClick={refresh} className="flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-cyan-300"><RefreshCw size={14}/>Refresh status</button>{done&&<button onClick={startOver} className="rounded-lg bg-white/5 px-4 py-2.5 text-xs font-bold text-zinc-300 hover:bg-white/10">Clear receipt</button>}</div>
  </div>;
}

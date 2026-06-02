import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Grid3X3, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useAuth } from "../state";

export function AuthPage({mode}:{mode:"login"|"register"}) {
  const {user,login,register}=useAuth(); const nav=useNavigate(); const [username,setUsername]=useState(""); const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  if(user)return <Navigate to="/"/>;
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError("");try{if(mode==="login")await login(email,password);else await register(username,email,password);nav("/");}catch(err){setError((err as Error).message)}finally{setBusy(false)}};
  return <main className="grid-glow grid min-h-[calc(100vh-64px)] place-items-center px-5 py-12"><div className="glass w-full max-w-md rounded-3xl p-7">
    <span className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-400 text-slate-950 shadow-[0_0_30px_#22d3ee55]"><Grid3X3/></span>
    <h1 className="mt-6 text-3xl font-black">{mode==="login"?"Welcome back.":"Create an account."}</h1>
    <p className="mt-2 text-sm leading-6 text-zinc-500">{mode==="login"?"Your next pixel is waiting.":"Free forever. Choose the handle that will appear beside your work."}</p>
    <form onSubmit={submit} className="mt-7 space-y-4">
      {mode==="register"&&<label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500"><UserRound size={14}/>Username</span><input autoFocus autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} pattern="[A-Za-z0-9_]{3,20}" title="Use 3-20 letters, numbers, or underscores." className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-cyan-400/60" required/></label>}
      <label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500"><Mail size={14}/>{mode==="login"?"Email or username":"Email"}</span><input autoFocus={mode==="login"} type={mode==="login"?"text":"email"} autoComplete={mode==="login"?"username":"email"} value={email} onChange={e=>setEmail(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-cyan-400/60" required/></label>
      <label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500"><LockKeyhole size={14}/>Password</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-cyan-400/60" required minLength={8}/></label>
      {error&&<p className="rounded-lg bg-rose-400/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-cyan-400 py-3 text-sm font-black text-slate-950 hover:bg-cyan-300 disabled:opacity-50">{busy?"Working...":mode==="login"?"Log in":"Create account"}</button>
    </form>
    <p className="mt-6 text-center text-xs text-zinc-500">{mode==="login"?"New to the wall? ":"Already have an account? "}<Link className="font-bold text-cyan-300" to={mode==="login"?"/register":"/login"}>{mode==="login"?"Register":"Log in"}</Link></p>
    {mode==="login"&&<p className="mt-3 text-center text-xs text-zinc-600">Restricted account? <Link className="font-bold text-cyan-300" to="/appeal">Apply for an appeal</Link></p>}
  </div></main>;
}

import { useEffect, useRef, useState } from "react";
import { Grid3X3, LogOut, UserRound } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../state";

const baseLinks = [["Live Canvas", "/"], ["Leaderboard", "/leaderboard"], ["About", "/about"], ["Rules", "/rules"]];
const linkClass = ({ isActive }: { isActive: boolean }) => `rounded-lg px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-cyan-300/70 ${isActive ? "bg-cyan-400/10 text-cyan-300" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`;

export function Navbar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const links = user ? [...baseLinks.slice(0, 2), ["My Profile", `/profile/${user.id}`], ...baseLinks.slice(2)] : baseLinks;

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const closeOutside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", closeOnEscape); document.removeEventListener("pointerdown", closeOutside); };
  }, [open]);

  return <header className="sticky top-0 z-50 border-b border-white/7 bg-[#07090f]/90 backdrop-blur-xl">
    <div className="mx-auto flex h-16 max-w-[1550px] items-center gap-3 px-4 sm:px-5">
      <Link to="/" className="mr-auto flex items-center gap-3 rounded-lg font-black tracking-tight focus:outline-none focus:ring-2 focus:ring-cyan-300/70"><span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-400 text-[#071016] shadow-[0_0_24px_#22d3ee88]"><Grid3X3 size={18}/></span><span className="hidden min-[390px]:inline">The Free <b className="text-cyan-300">Pixel Wall</b></span></Link>
      <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">{links.map(([name, path]) => <NavLink key={path} to={path} className={linkClass}>{name}</NavLink>)}</nav>
      <div className="hidden items-center gap-2 lg:flex">{user ? <><Link to={`/profile/${user.id}`} className="flex items-center gap-2 rounded-full bg-white/6 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-cyan-300/70"><UserRound size={15}/>{user.username}</Link><button onClick={logout} aria-label="Log out" title="Log out" className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/70"><LogOut size={18}/></button></> : <><Link to="/login" className="rounded-full px-4 py-2 text-sm font-bold text-zinc-300 hover:bg-white/5 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/70">Log in</Link><Link to="/register" className="rounded-full bg-cyan-400 px-4 py-2 text-sm font-bold text-[#071016] hover:bg-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-100">Register</Link></>}</div>
      <div ref={menu} className="relative lg:hidden">
        <button onClick={() => setOpen((value) => !value)} aria-label={open ? "Close navigation menu" : "Open navigation menu"} aria-expanded={open} className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/5 focus:outline-none focus:ring-2 focus:ring-cyan-300/70">
          <span className="relative block h-4 w-5">{[-6,0,6].map((top, index) => <i key={top} className={`absolute left-0 h-0.5 w-5 rounded bg-zinc-200 transition duration-200 ${open ? index===0 ? "translate-y-[6px] rotate-45" : index===1 ? "opacity-0" : "-translate-y-[6px] -rotate-45" : ""}`} style={{top:`${top+7}px`}}/>)}</span>
        </button>
        <div className={`absolute right-0 top-14 w-64 origin-top-right rounded-2xl border border-white/10 bg-[#10131d]/98 p-2 shadow-2xl backdrop-blur-xl transition duration-200 ${open ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0"}`}>
          <nav className="grid gap-1" aria-label="Mobile navigation">{links.map(([name,path]) => <NavLink key={path} to={path} className={linkClass}>{name}</NavLink>)}</nav>
          <div className="mt-2 border-t border-white/8 pt-2">{user ? <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-400 hover:bg-white/5 hover:text-white"><LogOut size={16}/>Log out</button> : <div className="grid grid-cols-2 gap-2"><Link to="/login" className="rounded-lg bg-white/5 px-3 py-2 text-center text-sm font-bold text-zinc-200">Log in</Link><Link to="/register" className="rounded-lg bg-cyan-400 px-3 py-2 text-center text-sm font-bold text-slate-950">Register</Link></div>}</div>
        </div>
      </div>
    </div>
  </header>;
}

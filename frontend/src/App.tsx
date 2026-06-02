import { Navigate, Route, Routes } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { useAuth } from "./state";
import { Navbar } from "./components/layout/Navbar";
import { Wall } from "./pages/Wall";
import { Leaderboard } from "./pages/Leaderboard";
import { Profile } from "./pages/Profile";
import { AuthPage } from "./pages/AuthPage";
import { InfoPage } from "./pages/InfoPage";
import { AppealPage } from "./pages/AppealPage";

export default function App() {
  const { user, loading } = useAuth();
  return <div className="min-h-screen bg-[#07090f]">
    <Navbar/>
    <Routes>
      <Route path="/" element={<Wall/>}/>
      <Route path="/leaderboard" element={<Leaderboard/>}/>
      <Route path="/profile/:id" element={<Profile/>}/>
      <Route path="/profile" element={loading ? <main className="grid-glow min-h-screen p-12 text-center text-zinc-500">Loading account...</main> : user ? <Navigate to={`/profile/${user.id}`}/> : <Navigate to="/login"/>}/>
      <Route path="/login" element={<AuthPage mode="login"/>}/>
      <Route path="/register" element={<AuthPage mode="register"/>}/>
      <Route path="/about" element={<InfoPage type="about"/>}/>
      <Route path="/rules" element={<InfoPage type="rules"/>}/>
      <Route path="/appeal" element={<AppealPage/>}/>
      <Route path="*" element={<Navigate to="/"/>}/>
    </Routes>
    <footer className="border-t border-white/5 px-5 py-6 text-center text-xs text-zinc-600"><BarChart3 className="mr-2 inline" size={14}/>A free public canvas. Every mark has a history.</footer>
  </div>;
}

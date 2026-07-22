import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { clearTokens, hasToken, isOperator } from './api';
import Distributions from './pages/Distributions';
import Events from './pages/Events';
import Flags from './pages/Flags';
import Health from './pages/Health';
import Login from './pages/Login';
import Pools from './pages/Pools';

function RequireOperator() {
  const location = useLocation();
  // Both conditions matter: a token proves who you are, the role decides what
  // this console may show. Neither is the authorization decision — the API's
  // PlatformRoleGuard is. This only avoids rendering screens that would 403.
  if (!hasToken() || !isOperator()) {
    return <Navigate replace to="/login" state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

function Shell() {
  const navigate = useNavigate();

  function signOut() {
    clearTokens();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to="/pools" aria-label="ooio admin home">
          <span className="brand-mark">O</span>
          <span>ooio <small>OPS</small></span>
        </NavLink>
        <nav className="main-nav" aria-label="Primary navigation">
          <NavLink to="/pools">Pools</NavLink>
          <NavLink to="/health">Health</NavLink>
          <NavLink to="/distributions">Distributions</NavLink>
          <NavLink to="/flags">Feature flags</NavLink>
          <NavLink to="/events">Events</NavLink>
        </nav>
        <button className="button button-quiet" type="button" onClick={signOut}>Sign out</button>
      </header>
      <main className="page-content"><Outlet /></main>
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleExpiry = () => navigate('/login', { replace: true });
    window.addEventListener('auth-expired', handleExpiry);
    return () => window.removeEventListener('auth-expired', handleExpiry);
  }, [navigate]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireOperator />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate replace to="/pools" />} />
          <Route path="pools" element={<Pools />} />
          <Route path="health" element={<Health />} />
          <Route path="distributions" element={<Distributions />} />
          <Route path="flags" element={<Flags />} />
          <Route path="events" element={<Events />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate replace to={hasToken() && isOperator() ? '/pools' : '/login'} />} />
    </Routes>
  );
}

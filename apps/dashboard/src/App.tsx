import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { clearTokens, hasToken } from './api';
import Billing from './pages/Billing';
import Clusters from './pages/Clusters';
import Login from './pages/Login';
import Stores from './pages/Stores';

function RequireAuth() {
  const location = useLocation();
  return hasToken() ? <Outlet /> : <Navigate replace to="/login" state={{ from: location.pathname }} />;
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
        <NavLink className="brand" to="/stores" aria-label="WooCloud home">
          <span className="brand-mark">W</span>
          <span>WooCloud <small>CONTROL PLANE</small></span>
        </NavLink>
        <nav className="main-nav" aria-label="Primary navigation">
          <NavLink to="/stores">Stores</NavLink>
          <NavLink to="/billing">Billing</NavLink>
          <NavLink to="/clusters">Cluster health</NavLink>
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
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate replace to="/stores" />} />
          <Route path="stores" element={<Stores />} />
          <Route path="billing" element={<Billing />} />
          <Route path="clusters" element={<Clusters />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate replace to={hasToken() ? '/stores' : '/login'} />} />
    </Routes>
  );
}

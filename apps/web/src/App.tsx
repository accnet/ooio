import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { clearTokens, hasToken } from './api';
import Billing from './pages/Billing';
import CreateStore from './pages/CreateStore';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Pricing from './pages/Pricing';
import Register from './pages/Register';
import Settings from './pages/Settings';
import Stores from './pages/Stores';
import StoreDetail from './pages/StoreDetail';

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
        <NavLink className="brand" to="/overview" aria-label="WooCloud home">
          <span className="brand-mark">W</span>
          <span>WooCloud <small>CONTROL PLANE</small></span>
        </NavLink>
        <nav className="main-nav" aria-label="Primary navigation">
          <NavLink to="/overview">Overview</NavLink>
          <NavLink to="/stores">Stores</NavLink>
          <NavLink to="/stores/new">New store</NavLink>
          <NavLink to="/billing">Billing</NavLink>
          <NavLink to="/settings">Settings</NavLink>
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
      <Route path="/register" element={<Register />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/" element={hasToken() ? <Navigate replace to="/overview" /> : <Landing />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route path="overview" element={<Overview />} />
          <Route path="stores" element={<Stores />} />
          <Route path="stores/:id" element={<StoreDetail />} />
          <Route path="stores/new" element={<CreateStore />} />
          <Route path="billing" element={<Billing />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate replace to={hasToken() ? '/overview' : '/'} />} />
    </Routes>
  );
}

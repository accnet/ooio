import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { clearTokens, hasToken, isSupport } from './api';
import Login from './pages/Login';
import Organizations from './pages/Organizations';
import OrganizationDetail from './pages/OrganizationDetail';
import Stores from './pages/Stores';

function RequireSupport() {
  const location = useLocation();
  // This is a UI convenience only. The API PlatformRoleGuard remains the real
  // authorization boundary and protects every /admin endpoint.
  if (!hasToken() || !isSupport()) {
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
        <NavLink className="brand" to="/organizations" aria-label="ooio support console home">
          <span className="brand-mark">S</span>
          <span>ooio <small>SUPPORT</small></span>
        </NavLink>
        <nav className="main-nav" aria-label="Support navigation">
          <NavLink to="/organizations">Organizations</NavLink>
          <NavLink to="/stores">Stores</NavLink>
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
      <Route element={<RequireSupport />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate replace to="/organizations" />} />
          <Route path="organizations" element={<Organizations />} />
          <Route path="organizations/:id" element={<OrganizationDetail />} />
          <Route path="stores" element={<Stores />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate replace to={hasToken() && isSupport() ? '/organizations' : '/login'} />} />
    </Routes>
  );
}

import { Link } from 'react-router-dom';

function PublicHeader() {
  return (
    <header className="public-header">
      <Link className="brand" to="/" aria-label="WooCloud home">
        <span className="brand-mark">W</span>
        <span>WooCloud <small>CONTROL PLANE</small></span>
      </Link>
      <nav className="public-nav" aria-label="Public navigation">
        <Link to="/features">Features</Link>
        <Link to="/pricing">Pricing</Link>
        <Link to="/contact">Contact</Link>
        <Link to="/login">Sign in</Link>
        <Link className="button button-primary" to="/register">Get started</Link>
      </nav>
    </header>
  );
}

export default function Landing() {
  return (
    <main className="public-page">
      <PublicHeader />
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="eyebrow">WooCommerce operations, made clear</p>
          <h1 id="landing-title">Your stores, running on a quieter control plane.</h1>
          <p className="landing-lede">
            WooCloud gives teams one dependable place to provision stores, follow operations, and
            keep capacity in view as the fleet grows.
          </p>
          <div className="landing-actions">
            <Link className="button button-primary" to="/register">Create your account</Link>
            <Link className="button button-secondary" to="/pricing">View pricing</Link>
          </div>
        </div>
        <div className="landing-visual" aria-label="WooCloud operations overview" role="img">
          <div className="landing-visual-header">
            <span className="eyebrow">Live operations</span>
            <span className="status-pill status-active">All systems ready</span>
          </div>
          <div className="landing-metric-grid">
            <div><span>Stores</span><strong>24</strong></div>
            <div><span>Capacity</span><strong>68%</strong></div>
            <div><span>Operations</span><strong>03</strong></div>
          </div>
          <div className="landing-activity">
            <div><span className="activity-dot activity-dot-live" />Provisioning storefront</div>
            <strong>Running</strong>
            <div><span className="activity-dot" />Store verification queued</div>
            <strong>Pending</strong>
            <div><span className="activity-dot activity-dot-done" />Store setup completed</div>
            <strong>Ready</strong>
          </div>
        </div>
      </section>
      <section className="landing-proof" aria-label="WooCloud platform benefits">
        <article className="panel">
          <p className="eyebrow">01 / Provision</p>
          <h2>Start stores with a clear path from request to ready.</h2>
          <p className="muted">Turn the setup workflow into a repeatable operation your team can follow.</p>
        </article>
        <article className="panel">
          <p className="eyebrow">02 / Operate</p>
          <h2>See the work that matters without the noise.</h2>
          <p className="muted">Track status, capacity, and the next action from one focused workspace.</p>
        </article>
        <article className="panel">
          <p className="eyebrow">03 / Grow</p>
          <h2>Make room for more stores with confidence.</h2>
          <p className="muted">Keep plans and store capacity visible before growth becomes a fire drill.</p>
        </article>
      </section>
      <footer className="public-footer">
        <span>WooCloud Control Plane</span>
        <span className="public-footer-links">
          <Link to="/features">See what is included</Link>
          <Link to="/contact">Contact the team</Link>
        </span>
      </footer>
    </main>
  );
}

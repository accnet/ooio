import { Link } from 'react-router-dom';

export default function Features() {
  return (
    <main className="public-page">
      <header className="public-header">
        <Link className="brand" to="/" aria-label="WooCloud home">
          <span className="brand-mark">W</span>
          <span>WooCloud <small>CONTROL PLANE</small></span>
        </Link>
        <nav className="public-nav" aria-label="Public navigation">
          <Link to="/">Home</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/login">Sign in</Link>
          <Link className="button button-primary" to="/register">Get started</Link>
        </nav>
      </header>

      <section className="public-page-intro" aria-labelledby="features-title">
        <p className="eyebrow">The essentials</p>
        <h1 id="features-title">A clear path from store request to day-to-day operations.</h1>
        <p className="landing-lede">
          WooCloud keeps the work around your WooCommerce stores in one focused control plane,
          with the details your team needs at each step.
        </p>
      </section>

      <section className="feature-grid" aria-label="WooCloud features">
        <article className="panel feature-card">
          <p className="eyebrow">01 / Provision</p>
          <h2>Create WooCommerce stores automatically.</h2>
          <p className="muted">
            Start a store from the control plane and let the provisioning operation handle the
            setup workflow for you.
          </p>
        </article>
        <article className="panel feature-card">
          <p className="eyebrow">02 / Track</p>
          <h2>Follow every operation as it moves.</h2>
          <p className="muted">
            See whether work is pending, running, complete, or failed, with progress and useful
            error details close at hand.
          </p>
        </article>
        <article className="panel feature-card">
          <p className="eyebrow">03 / Access</p>
          <h2>Manage API keys with confidence.</h2>
          <p className="muted">
            Create and revoke organization API keys, while the secret value is shown only once at
            creation time.
          </p>
        </article>
        <article className="panel feature-card">
          <p className="eyebrow">04 / Plan</p>
          <h2>Choose a plan with store limits in view.</h2>
          <p className="muted">
            Compare the plans available to your account and keep current store usage alongside the
            limit that applies to your organization.
          </p>
        </article>
      </section>

      <section className="public-callout panel" aria-labelledby="features-next-title">
        <div>
          <p className="eyebrow">Ready when you are</p>
          <h2 id="features-next-title">See how much room your stores need.</h2>
        </div>
        <div className="landing-actions">
          <Link className="button button-primary" to="/register">Create your account</Link>
          <Link className="button button-secondary" to="/pricing">View pricing</Link>
        </div>
      </section>

      <footer className="public-footer">
        <span>WooCloud Control Plane</span>
        <span className="public-footer-links">
          <Link to="/">Back to home</Link>
          <Link to="/contact">Contact the team</Link>
        </span>
      </footer>
    </main>
  );
}

import { Link } from 'react-router-dom';

export default function Contact() {
  return (
    <main className="public-page">
      <header className="public-header">
        <Link className="brand" to="/" aria-label="WooCloud home">
          <span className="brand-mark">W</span>
          <span>WooCloud <small>CONTROL PLANE</small></span>
        </Link>
        <nav className="public-nav" aria-label="Public navigation">
          <Link to="/">Home</Link>
          <Link to="/features">Features</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/login">Sign in</Link>
          <Link className="button button-primary" to="/register">Get started</Link>
        </nav>
      </header>

      <section className="public-page-intro contact-intro" aria-labelledby="contact-title">
        <p className="eyebrow">Let&apos;s talk</p>
        <h1 id="contact-title">Questions about running your stores?</h1>
        <p className="landing-lede">
          Tell us what you are planning and we can help you understand whether WooCloud fits your
          workflow.
        </p>
      </section>

      <section className="contact-layout" aria-label="Contact options">
        <article className="panel contact-card">
          <p className="eyebrow">Email</p>
          <h2>Reach the WooCloud team.</h2>
          <p className="muted">
            Send a note about your stores, organization, or plan and we&apos;ll pick up the
            conversation there.
          </p>
          <a className="button button-primary" href="mailto:hello@woocloud.example">
            Email hello@woocloud.example
          </a>
          <p className="contact-note">
            This opens your email client. There is no in-app contact form or automatic submission
            endpoint yet.
          </p>
        </article>
        <article className="panel contact-card contact-next">
          <p className="eyebrow">Before you reach out</p>
          <h2>See the product surface first.</h2>
          <p className="muted">
            Review what is available today, then compare plans when you are ready to create an
            account.
          </p>
          <div className="landing-actions">
            <Link className="button button-secondary" to="/features">Explore features</Link>
            <Link className="button button-secondary" to="/pricing">Compare pricing</Link>
          </div>
        </article>
      </section>

      <footer className="public-footer">
        <span>WooCloud Control Plane</span>
        <span className="public-footer-links">
          <Link to="/">Back to home</Link>
          <Link to="/features">Explore features</Link>
        </span>
      </footer>
    </main>
  );
}

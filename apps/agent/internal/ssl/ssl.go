package ssl

import (
	"context"
	"fmt"
	"strings"
)

// Issuer is the seam for the ACME/Let's Encrypt implementation. The concrete
// issuer is deliberately outside this foundation package so it can be added
// without coupling the agent to an ACME client or network in unit tests.
type Issuer interface {
	Issue(context.Context, string) error
	Renew(context.Context, string) error
}

// Reloader is the seam for reloading the node's TLS-serving configuration.
type Reloader interface {
	Reload(context.Context, string) error
}

// Manager coordinates certificate lifecycle operations and the subsequent
// reload. It does not contain ACME or Caddy policy.
type Manager struct {
	issuer   Issuer
	reloader Reloader
}

func NewManager(issuer Issuer, reloader Reloader) *Manager {
	return &Manager{issuer: issuer, reloader: reloader}
}

// New is kept as a concise constructor for callers wiring the agent at startup.
func New(issuer Issuer, reloader Reloader) *Manager {
	return NewManager(issuer, reloader)
}

func (m *Manager) Issue(ctx context.Context, domain string) error {
	return m.run(ctx, domain, "issue", func(ctx context.Context, domain string) error {
		return m.issuer.Issue(ctx, domain)
	})
}

func (m *Manager) Renew(ctx context.Context, domain string) error {
	return m.run(ctx, domain, "renew", func(ctx context.Context, domain string) error {
		return m.issuer.Renew(ctx, domain)
	})
}

func (m *Manager) run(ctx context.Context, domain, operation string, issue func(context.Context, string) error) error {
	if m == nil || m.issuer == nil || m.reloader == nil {
		return fmt.Errorf("SSL manager requires an issuer and reloader")
	}
	if ctx == nil {
		return fmt.Errorf("SSL operation requires a context")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return fmt.Errorf("domain is required")
	}
	if err := issue(ctx, domain); err != nil {
		return fmt.Errorf("%s certificate for %q: %w", operation, domain, err)
	}
	if err := m.reloader.Reload(ctx, domain); err != nil {
		return fmt.Errorf("reload TLS configuration after %s for %q: %w", operation, domain, err)
	}
	return nil
}

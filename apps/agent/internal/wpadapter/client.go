package wpadapter

import "context"

// Operation is intentionally transport- and topology-neutral. The concrete
// MU Plugin protocol remains open; this seam prevents Agent core from knowing
// whether a node uses Multisite or isolated WordPress sites.
type Operation struct {
	Name     string
	Resource string
	Payload  []byte
}

type Result struct {
	Payload []byte
}

// WordPressClient is the only boundary Agent core should use for WordPress
// operations. Implementations may use localhost HTTP, a Unix socket, or a
// future transport without changing the job runner.
type WordPressClient interface {
	Execute(context.Context, Operation) (Result, error)
}

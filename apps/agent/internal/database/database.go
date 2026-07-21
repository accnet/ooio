// Package database coordinates database allocation before WordPress site
// creation and produces the routing data consumed by HyperDB.
package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
)

var (
	// ErrNoAvailablePool means every configured pool is at capacity or the
	// allocator reported every candidate as full.
	ErrNoAvailablePool = errors.New("no available database pool")
	// ErrPoolFull lets an allocator ask the manager to try the next pool.
	ErrPoolFull = errors.New("database pool is full")
)

// Pool describes a database pool available to this agent. Capacity is an
// operational site limit, not a database-engine limit. A zero capacity means
// that the pool has no locally configured limit.
type Pool struct {
	ID       string `json:"id"`
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	Capacity int    `json:"capacity,omitempty"`
	Used     int    `json:"used,omitempty"`
}

// ConnectionInfo is returned by the allocator after it creates or assigns a
// database. The database package does not connect to MySQL itself.
type ConnectionInfo struct {
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	Database string `json:"database"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

// AllocationRequest is the allocator seam. The manager has already selected
// Pool before calling Allocate, which makes DB-before-site ordering explicit.
type AllocationRequest struct {
	SiteID string `json:"siteId"`
	Pool   Pool   `json:"pool"`
}

// Allocator creates or assigns a database in the requested pool. A concrete
// implementation may use MySQL or another provider, but that infrastructure
// remains outside this package.
type Allocator interface {
	Allocate(context.Context, AllocationRequest) (ConnectionInfo, error)
}

// Allocation is the result that must be passed to the subsequent site
// creation step. Site creation is intentionally not part of this manager.
type Allocation struct {
	SiteID     string         `json:"siteId"`
	PoolID     string         `json:"poolId"`
	Connection ConnectionInfo `json:"connection"`
}

// HyperDBRoute is the per-site routing record emitted by
// GenerateHyperDBConfig.
type HyperDBRoute struct {
	PoolID     string         `json:"poolId"`
	Connection ConnectionInfo `json:"connection"`
}

// Manager selects pools and records successful allocations. The mutex keeps
// capacity accounting and duplicate site allocation consistent when multiple
// provisioning jobs share one agent.
type Manager struct {
	mu          sync.Mutex
	allocator   Allocator
	pools       []Pool
	allocations map[string]Allocation
}

// NewManager constructs a database manager. Pool order is significant: the
// manager uses deterministic first-fit selection, skipping pools at capacity.
func NewManager(allocator Allocator, pools []Pool) *Manager {
	configured := append([]Pool(nil), pools...)
	return &Manager{
		allocator:   allocator,
		pools:       configured,
		allocations: make(map[string]Allocation),
	}
}

// New is an alias for callers wiring the agent at startup.
func New(allocator Allocator, pools []Pool) *Manager {
	return NewManager(allocator, pools)
}

// AllocateForSite creates or assigns the site's database before the caller
// invokes any WordPress site-creation operation. Repeating a successful call
// for the same site returns the existing allocation without allocating again.
func (m *Manager) AllocateForSite(ctx context.Context, siteID string) (Allocation, error) {
	if m == nil {
		return Allocation{}, fmt.Errorf("database manager is not configured")
	}
	if ctx == nil {
		return Allocation{}, fmt.Errorf("database allocation requires a context")
	}
	if err := ctx.Err(); err != nil {
		return Allocation{}, err
	}
	siteID = strings.TrimSpace(siteID)
	if siteID == "" {
		return Allocation{}, fmt.Errorf("site ID is required")
	}
	if m.allocator == nil {
		return Allocation{}, fmt.Errorf("database allocator is not configured")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.allocations[siteID]; ok {
		return existing, nil
	}

	for index := range m.pools {
		pool := m.pools[index]
		if strings.TrimSpace(pool.ID) == "" {
			continue
		}
		if poolAtCapacity(pool) {
			continue
		}

		connection, err := m.allocator.Allocate(ctx, AllocationRequest{SiteID: siteID, Pool: pool})
		if err != nil {
			if errors.Is(err, ErrPoolFull) {
				if pool.Capacity > 0 {
					m.pools[index].Used = pool.Capacity
				}
				continue
			}
			return Allocation{}, fmt.Errorf("allocate database for site %q in pool %q: %w", siteID, pool.ID, err)
		}

		allocation := Allocation{
			SiteID:     siteID,
			PoolID:     pool.ID,
			Connection: connection,
		}
		m.pools[index].Used++
		m.allocations[siteID] = allocation
		return allocation, nil
	}

	return Allocation{}, ErrNoAvailablePool
}

// GenerateHyperDBConfig returns deterministic JSON mapping site IDs to their
// allocated pool and connection. It is a handoff artifact for the HyperDB
// routing layer; it does not write files or mutate runtime configuration.
func (m *Manager) GenerateHyperDBConfig() (string, error) {
	if m == nil {
		return "", fmt.Errorf("database manager is not configured")
	}

	m.mu.Lock()
	routes := make(map[string]HyperDBRoute, len(m.allocations))
	for siteID, allocation := range m.allocations {
		routes[siteID] = HyperDBRoute{
			PoolID:     allocation.PoolID,
			Connection: allocation.Connection,
		}
	}
	m.mu.Unlock()

	data, err := json.MarshalIndent(routes, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encode HyperDB config: %w", err)
	}
	return string(data) + "\n", nil
}

func poolAtCapacity(pool Pool) bool {
	return pool.Capacity > 0 && pool.Used >= pool.Capacity
}

// Package database coordinates database allocation before WordPress site
// creation and exposes the topology-neutral runtime configuration seam.
package database

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
)

var (
	// ErrNoAvailablePool means every configured pool is at capacity or the
	// allocator reported every candidate as full.
	ErrNoAvailablePool = errors.New("no available database pool")
	// ErrPoolFull lets an allocator ask the manager to try the next pool.
	ErrPoolFull = errors.New("database pool is full")
	// ErrRuntimeTopologyNotConfigured makes the default runtime applier fail
	// closed until the ADR-005 topology is selected and implemented.
	ErrRuntimeTopologyNotConfigured = errors.New("runtime topology applier is not configured")
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

// Allocation is the topology-neutral result passed to runtime configuration.
//
// SiteID is retained for the existing provisioning handoff. Runtime
// configuration must use PoolID, Dataset, ConnectionRef, and Epoch only. In
// particular, credentials are deliberately absent: ConnectionRef points to a
// local secret such as secret://pool-a, which the agent resolves locally.
type Allocation struct {
	SiteID        string `json:"-"`
	PoolID        string `json:"poolId"`
	Dataset       string `json:"dataset"`
	ConnectionRef string `json:"connectionRef"`
	Epoch         int    `json:"epoch"`
}

// AllocationApplier materializes a DAS allocation in the selected runtime
// topology. Isolated and Multisite implementations intentionally remain
// outside this package because they operate at different points in the
// request lifecycle and may be implemented by different processes.
type AllocationApplier interface {
	ApplyAllocation(context.Context, Allocation) error
}

var _ AllocationApplier = NoopAllocationApplier{}

// AllocationLogger is the small logging seam used by the default applier.
// It keeps the implementation easy to test without introducing a logging
// dependency into the agent.
type AllocationLogger interface {
	Printf(string, ...any)
}

// NoopAllocationApplier is the default until ADR-005 selects a runtime
// topology. It records the allocation metadata and fails explicitly; it never
// reports that runtime configuration was materialized.
type NoopAllocationApplier struct {
	Logger AllocationLogger
}

// ApplyAllocation logs a clear handoff and fails closed. The connection
// reference is intentionally not logged because it is a secret lookup handle.
func (a NoopAllocationApplier) ApplyAllocation(ctx context.Context, allocation Allocation) error {
	if ctx == nil {
		return fmt.Errorf("runtime allocation requires a context")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := allocation.Validate(); err != nil {
		return err
	}

	logger := a.Logger
	if logger == nil {
		logger = log.Default()
	}
	logger.Printf("runtime allocation pending topology implementation: poolId=%q dataset=%q epoch=%d", allocation.PoolID, allocation.Dataset, allocation.Epoch)
	return ErrRuntimeTopologyNotConfigured
}

// Validate checks the fields shared by every runtime topology. It rejects
// raw connection details by construction: Allocation has only a secret ref.
func (a Allocation) Validate() error {
	if strings.TrimSpace(a.PoolID) == "" {
		return fmt.Errorf("allocation pool ID is required")
	}
	if strings.TrimSpace(a.Dataset) == "" {
		return fmt.Errorf("allocation dataset is required")
	}
	if !strings.HasPrefix(strings.TrimSpace(a.ConnectionRef), "secret://") || strings.TrimSpace(a.ConnectionRef) == "secret://" {
		return fmt.Errorf("allocation connectionRef must be a secret:// reference")
	}
	if a.Epoch <= 0 {
		return fmt.Errorf("allocation epoch must be positive")
	}
	return nil
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
			SiteID:        siteID,
			PoolID:        pool.ID,
			Dataset:       allocationDataset(siteID, connection.Database),
			ConnectionRef: "secret://" + pool.ID,
			Epoch:         1,
		}
		m.pools[index].Used++
		m.allocations[siteID] = allocation
		return allocation, nil
	}

	return Allocation{}, ErrNoAvailablePool
}

func poolAtCapacity(pool Pool) bool {
	return pool.Capacity > 0 && pool.Used >= pool.Capacity
}

func allocationDataset(siteID, databaseName string) string {
	if databaseName = strings.TrimSpace(databaseName); databaseName != "" {
		return databaseName
	}
	return "store_" + siteID
}

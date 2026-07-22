package database

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

type fakeAllocationLogger struct {
	messages []string
}

func (f *fakeAllocationLogger) Printf(format string, args ...any) {
	f.messages = append(f.messages, fmt.Sprintf(format, args...))
}

type fakeAllocator struct {
	requests []AllocationRequest
	byPool   map[string]ConnectionInfo
	err      error
	full     map[string]bool
}

func (f *fakeAllocator) Allocate(_ context.Context, request AllocationRequest) (ConnectionInfo, error) {
	f.requests = append(f.requests, request)
	if f.full[request.Pool.ID] {
		return ConnectionInfo{}, ErrPoolFull
	}
	if f.err != nil {
		return ConnectionInfo{}, f.err
	}
	return f.byPool[request.Pool.ID], nil
}

func TestAllocateForSiteSelectsAvailablePoolAndRecordsConnection(t *testing.T) {
	allocator := &fakeAllocator{
		byPool: map[string]ConnectionInfo{
			"pool-b": {Host: "mysql-b", Port: 3306, Database: "store_7"},
		},
	}
	manager := NewManager(allocator, []Pool{
		{ID: "pool-a", Capacity: 1, Used: 1},
		{ID: "pool-b", Capacity: 2},
	})

	allocation, err := manager.AllocateForSite(context.Background(), "store-7")
	if err != nil {
		t.Fatalf("AllocateForSite() error = %v", err)
	}
	if allocation.SiteID != "store-7" || allocation.PoolID != "pool-b" {
		t.Fatalf("allocation = %#v", allocation)
	}
	if allocation.Dataset != "store_7" || allocation.ConnectionRef != "secret://pool-b" || allocation.Epoch != 1 {
		t.Fatalf("runtime allocation = %#v", allocation)
	}
	if len(allocator.requests) != 1 || allocator.requests[0].Pool.ID != "pool-b" {
		t.Fatalf("allocator requests = %#v, want only available pool", allocator.requests)
	}

	repeated, err := manager.AllocateForSite(context.Background(), " store-7 ")
	if err != nil {
		t.Fatalf("repeated AllocateForSite() error = %v", err)
	}
	if repeated != allocation || len(allocator.requests) != 1 {
		t.Fatalf("repeated allocation = %#v, requests = %d; want idempotent result", repeated, len(allocator.requests))
	}
}

func TestAllocateForSiteAdvancesWhenAllocatorReportsPoolFull(t *testing.T) {
	allocator := &fakeAllocator{
		full: map[string]bool{"pool-a": true},
		byPool: map[string]ConnectionInfo{
			"pool-b": {Database: "store_8"},
		},
	}
	manager := NewManager(allocator, []Pool{{ID: "pool-a", Capacity: 1}, {ID: "pool-b"}})

	allocation, err := manager.AllocateForSite(context.Background(), "store-8")
	if err != nil {
		t.Fatalf("AllocateForSite() error = %v", err)
	}
	if allocation.PoolID != "pool-b" {
		t.Fatalf("pool ID = %q, want pool-b", allocation.PoolID)
	}
	if len(allocator.requests) != 2 {
		t.Fatalf("allocator requests = %d, want two candidates", len(allocator.requests))
	}
}

func TestAllocateForSiteReturnsPoolFullWhenAllPoolsAreFull(t *testing.T) {
	allocator := &fakeAllocator{full: map[string]bool{"pool-a": true, "pool-b": true}}
	manager := NewManager(allocator, []Pool{{ID: "pool-a"}, {ID: "pool-b"}})

	_, err := manager.AllocateForSite(context.Background(), "store-9")
	if !errors.Is(err, ErrNoAvailablePool) {
		t.Fatalf("AllocateForSite() error = %v, want ErrNoAvailablePool", err)
	}
	if len(allocator.requests) != 2 {
		t.Fatalf("allocator requests = %d, want two candidates", len(allocator.requests))
	}
}

func TestAllocateForSitePropagatesAllocatorError(t *testing.T) {
	allocatorErr := errors.New("mysql unavailable")
	manager := NewManager(&fakeAllocator{err: allocatorErr}, []Pool{{ID: "pool-a"}})

	_, err := manager.AllocateForSite(context.Background(), "store-10")
	if !errors.Is(err, allocatorErr) {
		t.Fatalf("AllocateForSite() error = %v, want allocator error", err)
	}
}

func TestAllocateForSiteRejectsConfiguredFullPools(t *testing.T) {
	allocator := &fakeAllocator{}
	manager := NewManager(allocator, []Pool{{ID: "pool-a", Capacity: 1, Used: 1}})

	_, err := manager.AllocateForSite(context.Background(), "store-11")
	if !errors.Is(err, ErrNoAvailablePool) {
		t.Fatalf("AllocateForSite() error = %v, want ErrNoAvailablePool", err)
	}
	if len(allocator.requests) != 0 {
		t.Fatalf("allocator requests = %d, want no calls to full pool", len(allocator.requests))
	}
}

func TestAllocationContainsNoConnectionCredentials(t *testing.T) {
	allocator := &fakeAllocator{
		byPool: map[string]ConnectionInfo{
			"pool-a": {Host: "mysql-a", Port: 3306, Database: "store_a", Username: "db-user", Password: "db-password"},
		},
	}
	manager := NewManager(allocator, []Pool{{ID: "pool-a"}})
	allocation, err := manager.AllocateForSite(context.Background(), "store-a")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(allocation)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "db-password") || strings.Contains(string(encoded), "mysql-a") || strings.Contains(string(encoded), "siteId") {
		t.Fatalf("allocation contains connection details: %s", encoded)
	}
	if err := allocation.Validate(); err != nil {
		t.Fatalf("allocation validation error = %v", err)
	}
	if allocation.ConnectionRef != "secret://pool-a" {
		t.Fatalf("connectionRef = %q", allocation.ConnectionRef)
	}
	if allocation.Epoch != 1 {
		t.Fatalf("epoch = %d, want 1", allocation.Epoch)
	}
}

func TestNoopAllocationApplierFailsClosedAndLogsMetadata(t *testing.T) {
	logger := &fakeAllocationLogger{}
	allocation := Allocation{PoolID: "pool-a", Dataset: "store_7", ConnectionRef: "secret://pool-a", Epoch: 3}

	err := (NoopAllocationApplier{Logger: logger}).ApplyAllocation(context.Background(), allocation)
	if !errors.Is(err, ErrRuntimeTopologyNotConfigured) {
		t.Fatalf("ApplyAllocation() error = %v, want ErrRuntimeTopologyNotConfigured", err)
	}
	if len(logger.messages) != 1 || !strings.Contains(logger.messages[0], "pool-a") || !strings.Contains(logger.messages[0], "store_7") {
		t.Fatalf("logs = %#v, want one allocation metadata log", logger.messages)
	}
	if strings.Contains(logger.messages[0], "secret://") {
		t.Fatalf("log exposed connection reference: %q", logger.messages[0])
	}
}

func TestNoopAllocationApplierRejectsCredentialLikeAllocation(t *testing.T) {
	err := (NoopAllocationApplier{}).ApplyAllocation(context.Background(), Allocation{
		PoolID: "pool-a", Dataset: "store_7", ConnectionRef: "mysql://user:password@host/db", Epoch: 1,
	})
	if err == nil || !strings.Contains(err.Error(), "secret://") {
		t.Fatalf("ApplyAllocation() error = %v, want secret reference validation error", err)
	}
}

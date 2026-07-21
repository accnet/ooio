package database

import (
	"context"
	"errors"
	"strings"
	"testing"
)

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
	if allocation.Connection.Database != "store_7" {
		t.Fatalf("connection = %#v", allocation.Connection)
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

func TestGenerateHyperDBConfigMapsSitesToPools(t *testing.T) {
	allocator := &fakeAllocator{
		byPool: map[string]ConnectionInfo{
			"pool-a": {Host: "mysql-a", Port: 3306, Database: "store_a"},
			"pool-b": {Host: "mysql-b", Port: 3306, Database: "store_b"},
		},
	}
	manager := NewManager(allocator, []Pool{{ID: "pool-a", Capacity: 1}, {ID: "pool-b"}})
	if _, err := manager.AllocateForSite(context.Background(), "store-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.AllocateForSite(context.Background(), "store-b"); err != nil {
		t.Fatal(err)
	}

	config, err := manager.GenerateHyperDBConfig()
	if err != nil {
		t.Fatalf("GenerateHyperDBConfig() error = %v", err)
	}
	if !strings.Contains(config, `"store-a"`) || !strings.Contains(config, `"poolId": "pool-a"`) {
		t.Fatalf("config = %s, want store-a route", config)
	}
	if !strings.Contains(config, `"store-b"`) || !strings.Contains(config, `"poolId": "pool-b"`) {
		t.Fatalf("config = %s, want store-b route", config)
	}
	if !strings.HasSuffix(config, "\n") {
		t.Fatal("config must end with a newline")
	}
}

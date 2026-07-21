package provision

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/accnet/ooio/apps/agent/internal/database"
	"github.com/accnet/ooio/apps/agent/internal/jobrunner"
	"github.com/accnet/ooio/apps/agent/internal/wpadapter"
)

type createStoreDatabaseFake struct {
	allocated []string
	released  []string
	err       error
}

func (f *createStoreDatabaseFake) AllocateForSite(_ context.Context, siteID string) (database.Allocation, error) {
	f.allocated = append(f.allocated, siteID)
	if f.err != nil {
		return database.Allocation{}, f.err
	}
	return database.Allocation{SiteID: siteID, PoolID: "pool-a"}, nil
}

type createStoreWordPressFake struct {
	operations []wpadapter.Operation
	result     wpadapter.Result
	err        error
}

func (f *createStoreWordPressFake) Execute(_ context.Context, operation wpadapter.Operation) (wpadapter.Result, error) {
	f.operations = append(f.operations, operation)
	return f.result, f.err
}

func TestCreateStoreOrchestratorRunsAllStepsInOrder(t *testing.T) {
	var events []string
	databaseFake := &createStoreDatabaseFake{}
	wordpress := &createStoreWordPressFake{result: wpadapter.Result{Payload: []byte(`{"siteId":"created-1"}`)}}
	action := func(name string) StoreAction {
		return func(_ context.Context, state *StoreContext) error {
			events = append(events, name+":"+state.Request.SiteID)
			return nil
		}
	}
	orchestrator := NewCreateStoreOrchestrator(CreateStoreDependencies{
		Database:             databaseFake,
		WordPress:            wordpress,
		ReleaseDatabase:      action("rollback-AllocateDB"),
		ActivateDistribution: action("ActivateDistribution"),
		Configure:            action("Configure"),
		CreateAdmin:          action("CreateAdmin"),
		AddDomain:            action("AddDomain"),
		Verify:               action("Verify"),
	})

	if err := orchestrator.CreateStore(context.Background(), json.RawMessage(`{"siteId":"store-1","domain":"store.example.test","title":"Store"}`)); err != nil {
		t.Fatalf("CreateStore() error = %v", err)
	}
	wantNames := []string{"AllocateDB", "CreateSite", "ActivateDistribution", "Configure", "CreateAdmin", "AddDomain", "Verify"}
	steps := orchestrator.Steps()
	gotNames := make([]string, len(steps))
	for index, step := range steps {
		gotNames[index] = step.Name
		if step.Execute == nil || step.Rollback == nil {
			t.Fatalf("step %q is missing an action", step.Name)
		}
	}
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("step names = %#v, want %#v", gotNames, wantNames)
	}
	if !reflect.DeepEqual(events, []string{
		"ActivateDistribution:created-1",
		"Configure:created-1",
		"CreateAdmin:created-1",
		"AddDomain:created-1",
		"Verify:created-1",
	}) {
		t.Fatalf("events = %#v", events)
	}
	if !reflect.DeepEqual(databaseFake.allocated, []string{"store-1"}) {
		t.Fatalf("allocated sites = %#v", databaseFake.allocated)
	}
	if len(wordpress.operations) != 1 || wordpress.operations[0].Name != "create-site" {
		t.Fatalf("WordPress operations = %#v", wordpress.operations)
	}
}

func TestCreateStoreOrchestratorRollsBackInReverseOrder(t *testing.T) {
	var events []string
	action := func(name string, failure error) StoreAction {
		return func(_ context.Context, _ *StoreContext) error {
			events = append(events, name)
			return failure
		}
	}
	databaseFake := &createStoreDatabaseFake{}
	wordpress := &createStoreWordPressFake{}
	orchestrator := NewCreateStoreOrchestrator(CreateStoreDependencies{
		Database:             databaseFake,
		WordPress:            wordpress,
		ReleaseDatabase:      action("rollback-AllocateDB", nil),
		ActivateDistribution: action("ActivateDistribution", nil),
		RollbackDistribution: action("rollback-ActivateDistribution", nil),
		Configure:            action("Configure", errors.New("profile is invalid")),
		RollbackConfigure:    action("rollback-Configure", nil),
		RollbackAdmin:        action("rollback-CreateAdmin", nil),
		RollbackDomain:       action("rollback-AddDomain", nil),
		RollbackVerify:       action("rollback-Verify", nil),
	})

	err := orchestrator.CreateStore(context.Background(), json.RawMessage(`{"domain":"store.example.test","title":"Store"}`))
	if err == nil || !strings.Contains(err.Error(), `step "Configure" failed`) {
		t.Fatalf("CreateStore() error = %v", err)
	}
	if !reflect.DeepEqual(events, []string{
		"ActivateDistribution",
		"Configure",
		"rollback-ActivateDistribution",
		"rollback-AllocateDB",
	}) {
		t.Fatalf("events = %#v, want forward failure then reverse rollback", events)
	}
	if len(wordpress.operations) != 2 || wordpress.operations[0].Name != "create-site" || wordpress.operations[1].Name != "delete-site" {
		t.Fatalf("WordPress operations = %#v", wordpress.operations)
	}
}

func TestHandlerUsesCreateStoreOrchestratorWhenConfigured(t *testing.T) {
	called := false
	orchestrator := NewCreateStoreOrchestratorWithSteps([]CreateStoreStep{{
		Name: "Verify",
		Execute: func(_ context.Context, _ *StoreContext) error {
			called = true
			return nil
		},
		Rollback: func(context.Context, *StoreContext) error { return nil },
	}})
	handler := NewHandler(nil, nil, nil, nil, orchestrator)
	if err := handler.Handle(context.Background(), jobrunnerJobCreateStore()); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if !called {
		t.Fatal("configured create-store orchestrator was not called")
	}
}

// Keep the handler test payload in one place without coupling this file to
// the jobrunner package's unrelated runner behavior.
func jobrunnerJobCreateStore() jobrunner.Job {
	return jobrunner.Job{Type: CreateStore, Payload: json.RawMessage(`{"domain":"store.example.test","title":"Store"}`)}
}

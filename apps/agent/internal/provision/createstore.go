package provision

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/accnet/ooio/apps/agent/internal/database"
	"github.com/accnet/ooio/apps/agent/internal/wpadapter"
)

// StoreAction is an injectable provisioning operation. The context contains
// the values produced by earlier steps, including the allocated database and
// the site ID returned by the WordPress adapter.
type StoreAction func(context.Context, *StoreContext) error

// CreateStoreStep is one forward operation and its compensating operation.
// Rollback is required for every step so a partial store is never silently
// left behind.
type CreateStoreStep struct {
	Name     string
	Execute  StoreAction
	Rollback StoreAction
}

// StoreRequest is the small set of fields used by the orchestration flow.
// The original payload remains available on StoreContext for adapters that
// need additional distribution-specific fields.
type StoreRequest struct {
	SiteID  string          `json:"siteId"`
	Domain  string          `json:"domain"`
	Path    string          `json:"path,omitempty"`
	Title   string          `json:"title"`
	Profile string          `json:"profile,omitempty"`
	Theme   string          `json:"theme,omitempty"`
	Plugins []string        `json:"plugins,omitempty"`
	Admin   json.RawMessage `json:"admin,omitempty"`
}

// StoreContext is shared by the ordered steps. It is intentionally an
// in-memory handoff and does not expose any WordPress topology assumptions.
type StoreContext struct {
	Payload    json.RawMessage
	Request    StoreRequest
	Allocation database.Allocation
	Created    bool
	Result     json.RawMessage
}

// DatabaseAllocator is the database-before-site seam used by the first step.
type DatabaseAllocator interface {
	AllocateForSite(context.Context, string) (database.Allocation, error)
}

// CreateStoreDependencies supplies infrastructure and domain actions to the
// orchestrator. Functions are used for later steps because their concrete
// implementations belong to other provisioning modules.
type CreateStoreDependencies struct {
	Database             DatabaseAllocator
	ReleaseDatabase      StoreAction
	WordPress            wpadapter.WordPressClient
	ActivateDistribution StoreAction
	RollbackDistribution StoreAction
	Configure            StoreAction
	RollbackConfigure    StoreAction
	CreateAdmin          StoreAction
	RollbackAdmin        StoreAction
	AddDomain            StoreAction
	RollbackDomain       StoreAction
	Verify               StoreAction
	RollbackVerify       StoreAction
}

// CreateStoreOrchestrator runs the fixed store lifecycle in order.
type CreateStoreOrchestrator struct {
	steps []CreateStoreStep
}

// NewCreateStoreOrchestrator creates the standard seven-step lifecycle.
func NewCreateStoreOrchestrator(dependencies CreateStoreDependencies) *CreateStoreOrchestrator {
	return &CreateStoreOrchestrator{steps: createStoreSteps(dependencies)}
}

// NewCreateStoreOrchestratorWithSteps is useful for adapters and tests that
// need to supply a step implementation while retaining rollback semantics.
func NewCreateStoreOrchestratorWithSteps(steps []CreateStoreStep) *CreateStoreOrchestrator {
	return &CreateStoreOrchestrator{steps: append([]CreateStoreStep(nil), steps...)}
}

// Steps returns a copy so callers can inspect the lifecycle without mutating
// the orchestrator's execution plan.
func (o *CreateStoreOrchestrator) Steps() []CreateStoreStep {
	if o == nil {
		return nil
	}
	return append([]CreateStoreStep(nil), o.steps...)
}

// CreateStore executes every step and compensates completed steps in reverse
// order when any forward operation fails.
func (o *CreateStoreOrchestrator) CreateStore(ctx context.Context, payload json.RawMessage) (json.RawMessage, error) {
	if o == nil {
		return nil, fmt.Errorf("create store orchestrator is not configured")
	}
	if ctx == nil {
		return nil, fmt.Errorf("create store requires a context")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	request, err := parseStoreRequest(payload)
	if err != nil {
		return nil, fmt.Errorf("create store payload: %w", err)
	}
	state := &StoreContext{Payload: append(json.RawMessage(nil), payload...), Request: request}

	completed := make([]CreateStoreStep, 0, len(o.steps))
	for _, step := range o.steps {
		if strings.TrimSpace(step.Name) == "" {
			return nil, fmt.Errorf("create store step has no name")
		}
		if step.Execute == nil {
			return nil, fmt.Errorf("create store step %q has no execute function", step.Name)
		}
		if step.Rollback == nil {
			return nil, fmt.Errorf("create store step %q has no rollback function", step.Name)
		}
		if err := step.Execute(ctx, state); err != nil {
			failure := fmt.Errorf("create store step %q failed: %w", step.Name, err)
			rollbackErrs := rollbackCompleted(context.WithoutCancel(ctx), completed, state)
			if len(rollbackErrs) != 0 {
				return nil, fmt.Errorf("%w; rollback errors: %w", failure, errors.Join(rollbackErrs...))
			}
			return nil, failure
		}
		completed = append(completed, step)
	}
	return state.Result, nil
}

// Run is an alias that makes the orchestrator usable as a conventional
// command-style component without duplicating lifecycle logic.
func (o *CreateStoreOrchestrator) Run(ctx context.Context, payload json.RawMessage) (json.RawMessage, error) {
	return o.CreateStore(ctx, payload)
}

func rollbackCompleted(ctx context.Context, completed []CreateStoreStep, state *StoreContext) []error {
	var rollbackErrs []error
	for index := len(completed) - 1; index >= 0; index-- {
		step := completed[index]
		if err := step.Rollback(ctx, state); err != nil {
			rollbackErrs = append(rollbackErrs, fmt.Errorf("step %q: %w", step.Name, err))
		}
	}
	return rollbackErrs
}

func createStoreSteps(dependencies CreateStoreDependencies) []CreateStoreStep {
	return []CreateStoreStep{
		{
			Name: "AllocateDB",
			Execute: func(ctx context.Context, state *StoreContext) error {
				if dependencies.Database == nil {
					return fmt.Errorf("database allocator is not configured")
				}
				allocation, err := dependencies.Database.AllocateForSite(ctx, state.Request.SiteID)
				if err != nil {
					return fmt.Errorf("allocate database: %w", err)
				}
				state.Allocation = allocation
				return nil
			},
			Rollback: rollbackOrNoop(dependencies.ReleaseDatabase),
		},
		{
			Name: "CreateSite",
			Execute: func(ctx context.Context, state *StoreContext) error {
				if dependencies.WordPress == nil {
					return fmt.Errorf("WordPress client is not configured")
				}
				result, err := dependencies.WordPress.Execute(ctx, wpadapter.Operation{Name: "create-site", Payload: state.Payload})
				if err != nil {
					return fmt.Errorf("create site: %w", err)
				}
				state.Created = true
				blogID, err := responseBlogID(result.Payload)
				if err != nil {
					return err
				}
				state.Request.SiteID = strconv.FormatInt(blogID, 10)
				state.Result = json.RawMessage(fmt.Sprintf(`{"blogId":%d}`, blogID))
				return nil
			},
			Rollback: func(ctx context.Context, state *StoreContext) error {
				if !state.Created {
					return nil
				}
				if dependencies.WordPress == nil {
					return fmt.Errorf("WordPress client is not configured")
				}
				_, err := dependencies.WordPress.Execute(ctx, wpadapter.Operation{Name: "delete-site", Resource: state.Request.SiteID})
				if err != nil {
					return fmt.Errorf("delete site: %w", err)
				}
				return nil
			},
		},
		{
			Name:     "ActivateDistribution",
			Execute:  actionOrNoop(dependencies.ActivateDistribution),
			Rollback: rollbackOrNoop(dependencies.RollbackDistribution),
		},
		{
			Name:     "Configure",
			Execute:  actionOrNoop(dependencies.Configure),
			Rollback: rollbackOrNoop(dependencies.RollbackConfigure),
		},
		{
			Name:     "CreateAdmin",
			Execute:  actionOrNoop(dependencies.CreateAdmin),
			Rollback: rollbackOrNoop(dependencies.RollbackAdmin),
		},
		{
			Name:     "AddDomain",
			Execute:  actionOrNoop(dependencies.AddDomain),
			Rollback: rollbackOrNoop(dependencies.RollbackDomain),
		},
		{
			Name:     "Verify",
			Execute:  actionOrNoop(dependencies.Verify),
			Rollback: rollbackOrNoop(dependencies.RollbackVerify),
		},
	}
}

func actionOrNoop(action StoreAction) StoreAction {
	if action == nil {
		return func(context.Context, *StoreContext) error { return nil }
	}
	return action
}

func rollbackOrNoop(action StoreAction) StoreAction {
	return actionOrNoop(action)
}

func parseStoreRequest(payload json.RawMessage) (StoreRequest, error) {
	if err := validateObjectPayload(payload); err != nil {
		return StoreRequest{}, err
	}
	var request StoreRequest
	if err := json.Unmarshal(payload, &request); err != nil {
		return StoreRequest{}, fmt.Errorf("must be valid JSON: %w", err)
	}
	request.SiteID = strings.TrimSpace(request.SiteID)
	if request.SiteID == "" {
		var aliases struct {
			ID      string `json:"id"`
			StoreID string `json:"storeId"`
		}
		if err := json.Unmarshal(payload, &aliases); err != nil {
			return StoreRequest{}, fmt.Errorf("must be valid JSON: %w", err)
		}
		request.SiteID = strings.TrimSpace(aliases.StoreID)
		if request.SiteID == "" {
			request.SiteID = strings.TrimSpace(aliases.ID)
		}
	}
	request.Domain = strings.TrimSpace(request.Domain)
	request.Title = strings.TrimSpace(request.Title)
	if request.SiteID == "" {
		request.SiteID = request.Domain
	}
	if request.SiteID == "" {
		return StoreRequest{}, fmt.Errorf("siteId or domain is required")
	}
	if request.Domain == "" {
		return StoreRequest{}, fmt.Errorf("domain is required")
	}
	if request.Title == "" {
		return StoreRequest{}, fmt.Errorf("title is required")
	}
	request.Profile = strings.TrimSpace(request.Profile)
	return request, nil
}

// The MU plugin returns the new blog as `siteId`, and as a STRING — see
// runtime/mu-plugin Rest/Controller.php and every other siteId field in this
// agent. The value reported onward to the Control Plane is named `blogId`
// because that is the column it lands in; only the wire name differs.
//
// Refusing a non-positive value is deliberate: a wrong blog id is worse than a
// missing one, because the Control Plane would publish a mapping pointing at
// the wrong blog.
func responseBlogID(payload []byte) (int64, error) {
	var response struct {
		SiteID string `json:"siteId"`
	}
	if err := json.Unmarshal(payload, &response); err != nil {
		return 0, fmt.Errorf("create site response is not valid JSON: %w", err)
	}
	blogID, err := strconv.ParseInt(strings.TrimSpace(response.SiteID), 10, 64)
	if err != nil || blogID <= 0 {
		return 0, fmt.Errorf("create site response must contain a positive integer siteId, got %q", response.SiteID)
	}
	return blogID, nil
}

func createStoreResult(payload []byte) (json.RawMessage, error) {
	blogID, err := responseBlogID(payload)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(fmt.Sprintf(`{"blogId":%d}`, blogID)), nil
}

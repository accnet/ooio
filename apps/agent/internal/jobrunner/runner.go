package jobrunner

import (
	"context"
	"fmt"
	"log"
	"time"
)

// Handler is the seam for track-specific job execution. The runner only
// coordinates lifecycle and reporting; it does not interpret job payloads.
type Handler interface {
	Handle(context.Context, Job) error
}

type JobClient interface {
	Poll(context.Context) ([]Job, error)
	ReportResult(context.Context, string, JobResult) error
}

type Runner struct {
	client     JobClient
	handler    Handler
	interval   time.Duration
	maxBackoff time.Duration
	logger     *log.Logger
}

func New(client JobClient, handler Handler, interval time.Duration, logger *log.Logger) *Runner {
	if logger == nil {
		logger = log.Default()
	}
	maxBackoff := interval * 8
	if maxBackoff < interval || maxBackoff <= 0 {
		maxBackoff = 5 * time.Minute
	}
	return &Runner{
		client:     client,
		handler:    handler,
		interval:   interval,
		maxBackoff: maxBackoff,
		logger:     logger,
	}
}

func (r *Runner) Run(ctx context.Context) error {
	if r == nil || r.client == nil || r.handler == nil {
		return fmt.Errorf("job runner requires a client and handler")
	}
	if r.interval <= 0 {
		return fmt.Errorf("poll interval must be positive")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	delay := r.interval
	for {
		err := r.pollAndHandle(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			r.logger.Printf("job poll failed: %v", err)
			delay = nextBackoff(delay, r.maxBackoff)
		} else {
			delay = r.interval
		}
		if err := wait(ctx, delay); err != nil {
			return err
		}
	}
}

func (r *Runner) pollAndHandle(ctx context.Context) error {
	jobs, err := r.client.Poll(ctx)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		if err := ctx.Err(); err != nil {
			return err
		}

		result := JobResult{Status: JobResultSucceeded}
		if err := r.handler.Handle(ctx, job); err != nil {
			result = JobResult{
				Status: JobResultFailed,
				Error: &JobError{
					Code:    "handler_error",
					Message: err.Error(),
				},
			}
		}
		if err := r.client.ReportResult(ctx, job.ID, result); err != nil {
			return fmt.Errorf("report job %q result: %w", job.ID, err)
		}
	}
	return nil
}

func nextBackoff(delay, maximum time.Duration) time.Duration {
	if delay <= 0 {
		return maximum
	}
	if delay > maximum/2 {
		return maximum
	}
	return delay * 2
}

func wait(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

type NopHandler struct{}

func (NopHandler) Handle(context.Context, Job) error { return nil }

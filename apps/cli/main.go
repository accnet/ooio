package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, output, errors io.Writer) int {
	flags := flag.NewFlagSet("ooio-cli", flag.ContinueOnError)
	flags.SetOutput(errors)
	baseURL := flags.String("base-url", defaultBaseURL, "MU Plugin WordPress REST base URL")
	token := flags.String("token", "", "MU Plugin bearer token")
	if err := flags.Parse(args); err != nil {
		return 2
	}

	remaining := flags.Args()
	if len(remaining) == 0 {
		printUsage(errors)
		return 2
	}
	if strings.TrimSpace(*token) == "" {
		fmt.Fprintln(errors, "--token is required")
		return 2
	}

	client := NewClient(*baseURL, *token)
	var (
		result json.RawMessage
		err    error
	)

	switch remaining[0] {
	case "create-store":
		result, err = runCreateStore(client, remaining[1:], errors)
	case "delete-store":
		result, err = runDeleteStore(client, remaining[1:], errors)
	case "health":
		if len(remaining) != 1 {
			fmt.Fprintln(errors, "health does not accept positional arguments")
			return 2
		}
		result, err = client.Health(context.Background())
	default:
		fmt.Fprintf(errors, "unknown command %q\n", remaining[0])
		printUsage(errors)
		return 2
	}
	if err != nil {
		fmt.Fprintln(errors, err)
		return 1
	}
	if err := printJSON(output, result); err != nil {
		fmt.Fprintln(errors, err)
		return 1
	}
	return 0
}

func runCreateStore(client *Client, args []string, errors io.Writer) (json.RawMessage, error) {
	flags := flag.NewFlagSet("create-store", flag.ContinueOnError)
	flags.SetOutput(errors)
	domain := flags.String("domain", "", "site domain")
	title := flags.String("title", "", "site title")
	path := flags.String("path", "", "optional site path")
	networkID := flags.String("network-id", "", "optional WordPress network id")
	if err := flags.Parse(args); err != nil {
		return nil, err
	}
	if len(flags.Args()) != 0 {
		return nil, fmt.Errorf("create-store does not accept positional arguments")
	}
	return client.CreateStore(context.Background(), CreateStoreRequest{
		Domain:    *domain,
		Title:     *title,
		Path:      *path,
		NetworkID: *networkID,
	})
}

func runDeleteStore(client *Client, args []string, errors io.Writer) (json.RawMessage, error) {
	flags := flag.NewFlagSet("delete-store", flag.ContinueOnError)
	flags.SetOutput(errors)
	siteID := flags.String("site-id", "", "positive WordPress site id")
	if err := flags.Parse(args); err != nil {
		return nil, err
	}
	positional := flags.Args()
	if *siteID != "" && len(positional) != 0 {
		return nil, fmt.Errorf("site id must be provided either as --site-id or as one positional argument")
	}
	if *siteID == "" {
		if len(positional) != 1 {
			return nil, fmt.Errorf("delete-store requires a site id")
		}
		siteID = &positional[0]
	} else if len(positional) != 0 {
		return nil, fmt.Errorf("delete-store accepts only one site id")
	}
	return client.DeleteStore(context.Background(), *siteID)
}

func printJSON(output io.Writer, payload []byte) error {
	var value interface{}
	if err := json.Unmarshal(payload, &value); err != nil {
		return fmt.Errorf("decode command result: %w", err)
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func printUsage(output io.Writer) {
	fmt.Fprintln(output, "Usage: ooio-cli [--base-url URL] --token TOKEN <command> [flags]")
	fmt.Fprintln(output, "Commands: create-store, delete-store, health")
}

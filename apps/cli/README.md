# Runtime CLI

This standalone Go CLI operates a local WordPress MU Plugin directly. It does
not call the SaaS API or import the Agent module.

The MU Plugin base URL includes the WordPress REST prefix. The default is
`http://127.0.0.1/wp-json`; use `--base-url` when WordPress runs elsewhere.

```text
go run . --base-url http://127.0.0.1/wp-json --token SECRET create-store \
  --domain store.example.test --title "Example Store" [--path /store]
go run . --base-url http://127.0.0.1/wp-json --token SECRET delete-store 7
go run . --base-url http://127.0.0.1/wp-json --token SECRET health
```

Every successful command prints the MU Plugin JSON response with indentation.
Usage errors exit with code 2; HTTP and operation errors exit with code 1.

The current MU Plugin contract exposes health as the read-only store/runtime
inspection command. A list-stores endpoint is not yet part of that contract.

# WooCloud Dashboard

React and Vite control-plane SPA for WooCloud. It authenticates with the SaaS API,
lists and provisions stores, monitors operation progress, shows billing usage, and
reports whether cluster health data is available.

## Development

```bash
npm run dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:3100`. The dashboard never
accesses the database directly; all data flows through `src/api.ts` with the current
Bearer token.

## Build

```bash
npm run build
```

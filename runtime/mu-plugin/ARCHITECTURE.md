# Platform Core MU Plugin

Draft skeleton for the localhost WordPress data-plane API described in
`Blueprint/07-MU-Plugin.md` and ADR-003.

## Request path

```text
REST Controller -> SiteService -> WordPressAdapter -> WordPress Core API
```

`WordPressAdapter` is an interface so the application layer does not depend on
the details of WordPress Core. `CoreWordPressAdapter` is the initial adapter and
contains only thin calls to Core APIs such as `wpmu_create_blog`,
`activate_plugin`, `switch_theme`, `wp_insert_user`, and `update_option`.

## Transport and authentication

The plugin is intended to be served only from `127.0.0.1`; the web server/PHP
runtime must bind the REST virtual host accordingly. The controller also rejects
requests whose remote address is not localhost. Mutating routes use a bearer
token compared with the `PLATFORM_CORE_SHARED_SECRET` constant as the ADR-003
shared-secret authentication stub. Health still requires localhost access but
does not require the bearer token, matching the draft OpenAPI contract.

Transport selection between localhost REST and a Unix domain socket remains
open under ADR-003.

## Scope

This is a REST and adapter skeleton only. It contains no SaaS billing,
subscription, dashboard, or direct-database logic. Composer metadata is present
for PSR-4 loading; dependencies are intentionally not installed in this phase.


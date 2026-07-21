# Distribution Configuration Profiles

The distribution provides three PHP configuration profiles:

- `default.php` contains the conservative base WordPress constants.
- `performance.php` enables Redis object caching and moves WP-Cron to an external scheduler.
- `security.php` disables dashboard file editing, requires SSL for administration, enables minor core updates, and limits post revisions.

Each profile returns an array and does not require WordPress. Load `loader.php` from
`wp-config.php` or another bootstrap file. The loader selects a profile in this order:

1. An already-defined `WP_DISTRIBUTION_PROFILE` constant.
2. The `WP_DISTRIBUTION_PROFILE` environment variable.
3. `default` when neither is set.

The selected profile is merged over the default profile. Constants are defined only
when they are not already defined, so an existing deployment-specific value is kept.
Invalid profile names throw `InvalidArgumentException`.

Example:

```php
$distributionConfig = require __DIR__ . '/config/loader.php';
```

Set `WP_DISTRIBUTION_PROFILE=performance` or `WP_DISTRIBUTION_PROFILE=security`
before loading the file to select an override profile.

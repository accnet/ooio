#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../../.." && pwd)"
config_file="$script_dir/node-config.env"
mode=""
prefix_arg=""
agent_binary_arg=""
dry_run=0

usage() {
  cat <<'EOF'
Usage: install-node.sh [--config PATH] [--prefix PATH | --system]
                       [--agent-binary PATH] [--dry-run]
EOF
}
die() { printf 'install-node.sh: %s\n' "$*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --config) (($# > 1)) || die '--config requires a path'; config_file="$2"; shift 2 ;;
    --prefix) (($# > 1)) || die '--prefix requires a path'; mode=prefix; prefix_arg="$2"; shift 2 ;;
    --system) mode=system; shift ;;
    --agent-binary) (($# > 1)) || die '--agent-binary requires a path'; agent_binary_arg="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

if [[ -f "$config_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$config_file"
  set +a
fi
[[ -z "$prefix_arg" ]] || NODE_PREFIX="$prefix_arg"
[[ -z "$agent_binary_arg" ]] || AGENT_BINARY="$agent_binary_arg"
mode="${mode:-${NODE_MODE:-system}}"
[[ "$mode" == system || "$mode" == prefix ]] || die 'NODE_MODE must be system or prefix'

if [[ "$mode" == prefix ]]; then
  NODE_PREFIX="${NODE_PREFIX:-$HOME/ooio-devenv}"
  NODE_PREFIX="${NODE_PREFIX%/}"
  [[ -n "$NODE_PREFIX" && "$NODE_PREFIX" != / ]] || die '--prefix must not be /'
  etc_root="$NODE_PREFIX/etc"; var_root="$NODE_PREFIX/var"; run_root="$NODE_PREFIX/run"
  WP_PATH="${WP_PATH:-$var_root/www/wordpress}"
  MARIADB_DATA_DIR="${MARIADB_DATA_DIR:-$var_root/lib/mysql}"
  MARIADB_SOCKET="${MARIADB_SOCKET:-$run_root/mariadb/mariadb.sock}"
  REDIS_DATA_DIR="${REDIS_DATA_DIR:-$var_root/lib/redis}"
  REDIS_PID_FILE="${REDIS_PID_FILE:-$run_root/redis/redis-server.pid}"
  REDIS_LOG_FILE="${REDIS_LOG_FILE:-$var_root/log/redis/redis-server.log}"
  AGENT_INSTALL_PATH="${AGENT_INSTALL_PATH:-$NODE_PREFIX/usr/local/bin/platform-agent}"
  AGENT_CONFIG_DIR="${AGENT_CONFIG_DIR:-$etc_root/platform-agent}"
  SERVICE_FILE="${SERVICE_FILE:-$etc_root/systemd/system/platform-agent.service}"
  CADDY_CONFIG_FILE="${CADDY_CONFIG_FILE:-$etc_root/caddy/Caddyfile}"
else
  NODE_PREFIX=/; etc_root=/etc; var_root=/var; run_root=/run
  WP_PATH="${WP_PATH:-/var/www/wordpress}"
  MARIADB_DATA_DIR="${MARIADB_DATA_DIR:-/var/lib/mysql}"
  MARIADB_SOCKET="${MARIADB_SOCKET:-/run/mysqld/mysqld.sock}"
  REDIS_DATA_DIR="${REDIS_DATA_DIR:-/var/lib/redis}"
  REDIS_PID_FILE="${REDIS_PID_FILE:-/run/redis/redis-server.pid}"
  REDIS_LOG_FILE="${REDIS_LOG_FILE:-/var/log/redis/redis-server.log}"
  AGENT_INSTALL_PATH="${AGENT_INSTALL_PATH:-/usr/local/bin/platform-agent}"
  AGENT_CONFIG_DIR="${AGENT_CONFIG_DIR:-/etc/platform-agent}"
  SERVICE_FILE="${SERVICE_FILE:-/etc/systemd/system/platform-agent.service}"
  CADDY_CONFIG_FILE="${CADDY_CONFIG_FILE:-/etc/caddy/Caddyfile}"
fi

WP_URL="${WP_URL:-http://127.0.0.1}"
WP_TITLE="${WP_TITLE:-WooCommerce Cloud Node}"
WP_VERSION="${WP_VERSION:-latest}"
WP_CLI_PATH="${WP_CLI_PATH:-$etc_root/platform-agent/bin/wp}"
WP_CLI_URL="${WP_CLI_URL:-https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar}"
MU_PLUGIN_SOURCE="${MU_PLUGIN_SOURCE:-$repo_root/runtime/mu-plugin/platform-core.php}"
MU_PLUGIN_TARGET="${MU_PLUGIN_TARGET:-$WP_PATH/wp-content/mu-plugins/platform-core.php}"
MARIADB_HOST="${MARIADB_HOST:-127.0.0.1}"; MARIADB_PORT="${MARIADB_PORT:-3306}"
MARIADB_DATABASE="${MARIADB_DATABASE:-wordpress}"; MARIADB_USER="${MARIADB_USER:-wordpress}"
MARIADB_PASSWORD="${MARIADB_PASSWORD:-change-me-in-development}"; MARIADB_ROOT_PASSWORD="${MARIADB_ROOT_PASSWORD:-}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"; REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_SERVICE="${REDIS_SERVICE:-redis-server}"; REDIS_PACKAGE="${REDIS_PACKAGE:-redis-server}"
LUDICROUSDB_ENABLED="${LUDICROUSDB_ENABLED:-${HYPERDB_ENABLED:-true}}"
LUDICROUSDB_SOURCE_URL="${LUDICROUSDB_SOURCE_URL:-https://github.com/stuttter/ludicrousdb/archive/refs/heads/master.zip}"
LUDICROUSDB_PLUGIN_DIR="${LUDICROUSDB_PLUGIN_DIR:-$WP_PATH/wp-content/plugins/ludicrousdb}"
DISTRIBUTION_INSTALLER="${DISTRIBUTION_INSTALLER:-$repo_root/runtime/distribution/install-plugins.sh}"
PLUGIN_SET_ENABLED="${PLUGIN_SET_ENABLED:-true}"
LUDICROUSDB_DROPIN_TARGET="${LUDICROUSDB_DROPIN_TARGET:-$WP_PATH/wp-content/db.php}"
# LudicrousDB looks for db-config.php at DB_CONFIG_FILE, ABSPATH, or
# WP_CONTENT_DIR. Keep it at the WordPress root (ABSPATH) — that path works for
# both LudicrousDB and the legacy HyperDB layout.
LUDICROUSDB_CONFIG_FILE="${LUDICROUSDB_CONFIG_FILE:-$WP_PATH/db-config.php}"
PHP_FPM_SERVICE="${PHP_FPM_SERVICE:-}"; PHP_FPM_ADDRESS="${PHP_FPM_ADDRESS:-127.0.0.1:9000}"
CADDY_SITE_ADDRESS="${CADDY_SITE_ADDRESS:-:80}"; CADDY_SERVICE="${CADDY_SERVICE:-caddy}"
AGENT_BINARY="${AGENT_BINARY:-$script_dir/../platform-agent}"
AGENT_SERVICE_NAME="${AGENT_SERVICE_NAME:-platform-agent}"
AGENT_SERVICE_USER="${AGENT_SERVICE_USER:-platform-agent}"; AGENT_SERVICE_GROUP="${AGENT_SERVICE_GROUP:-platform-agent}"
PLATFORM_CORE_SHARED_SECRET="${PLATFORM_CORE_SHARED_SECRET:-}"

plan() { ((dry_run)) && printf '[dry-run] %s\n' "$*" || :; }
run() { ((dry_run)) || "$@"; }
command_available() { command -v "$1" >/dev/null 2>&1; }

validate_settings() {
  [[ "$MARIADB_DATABASE" =~ ^[A-Za-z0-9_]+$ ]] || die 'MARIADB_DATABASE has invalid characters'
  [[ "$MARIADB_USER" =~ ^[A-Za-z0-9_]+$ ]] || die 'MARIADB_USER has invalid characters'
  [[ "$MARIADB_PORT" =~ ^[0-9]+$ ]] || die 'MARIADB_PORT must be numeric'
  [[ "$REDIS_PORT" =~ ^[0-9]+$ ]] || die 'REDIS_PORT must be numeric'
  if (( !dry_run )); then
    [[ -n "$PLATFORM_CORE_SHARED_SECRET" ]] || die 'PLATFORM_CORE_SHARED_SECRET is required outside dry-run'
    [[ "$PLATFORM_CORE_SHARED_SECRET" != change-me-* ]] || die 'replace the development shared secret before installing'
  fi
}

ensure_dir() { if ((dry_run)); then plan "create directory $1"; else install -d -m "${2:-0755}" "$1"; fi; }

ensure_dependencies() {
  local packages=(mariadb-server mariadb-client php php-cli php-curl php-mbstring php-mysql php-xml php-fpm caddy curl ca-certificates unzip python3 "$REDIS_PACKAGE")
  local missing=() name
  for name in curl unzip php python3 redis-server; do command_available "$name" || missing+=("$name"); done
  command_available mariadb || command_available mysql || missing+=(mariadb)
  command_available caddy || missing+=(caddy)
  ((${#missing[@]} == 0)) && { plan 'required runtime commands are available'; return; }
  if [[ "$mode" == prefix ]]; then
    if ((dry_run)); then plan "prefix mode expects preinstalled commands: ${missing[*]}"; else die "prefix mode cannot install missing commands: ${missing[*]}"; fi
  else
    if ((dry_run)); then plan "install missing host packages if needed: ${packages[*]}"; return; fi
    command_available apt-get || die 'apt-get is required to install missing host dependencies'
    apt-get update
    apt-get install -y "${packages[@]}"
  fi
}

ensure_redis() {
  ensure_dir "$REDIS_DATA_DIR" 0750
  ensure_dir "$(dirname -- "$REDIS_PID_FILE")" 0755
  ensure_dir "$(dirname -- "$REDIS_LOG_FILE")" 0750
  if [[ "$mode" == system ]]; then
    if ((dry_run)); then plan "enable and start Redis service $REDIS_SERVICE"; else systemctl enable --now "$REDIS_SERVICE"; fi
    return
  fi

  if [[ -f "$REDIS_PID_FILE" ]] && kill -0 "$(<"$REDIS_PID_FILE")" 2>/dev/null; then
    plan "skip Redis startup: pid $(<"$REDIS_PID_FILE") is running"
  elif ((dry_run)); then
    plan "start Redis in background on $REDIS_HOST:$REDIS_PORT"
  else
    command_available redis-server || die 'redis-server is required in prefix mode'
    redis-server --daemonize yes --bind "$REDIS_HOST" --port "$REDIS_PORT" \
      --dir "$REDIS_DATA_DIR" --pidfile "$REDIS_PID_FILE" --logfile "$REDIS_LOG_FILE"
  fi
}

ensure_mariadb() {
  local init_command=''
  command_available mariadb-install-db && init_command=mariadb-install-db
  [[ -n "$init_command" ]] || { command_available mysql_install_db && init_command=mysql_install_db || :; }
  ensure_dir "$MARIADB_DATA_DIR" 0750; ensure_dir "$(dirname -- "$MARIADB_SOCKET")" 0755
  if [[ ! -d "$MARIADB_DATA_DIR/mysql" ]]; then
    if ((dry_run)); then plan "initialize MariaDB datadir $MARIADB_DATA_DIR"; else [[ -n "$init_command" ]] || die 'mariadb-install-db is required'; "$init_command" --datadir="$MARIADB_DATA_DIR" --skip-test-db --auth-root-authentication-method=normal; fi
  else
    plan "skip MariaDB datadir initialization: $MARIADB_DATA_DIR/mysql exists"
  fi
  if [[ "$mode" == system ]]; then
    if ((dry_run)); then plan 'enable and start MariaDB with systemd'; else systemctl enable --now mariadb; fi
  elif [[ ! -S "$MARIADB_SOCKET" ]]; then
    if ((dry_run)); then plan "start local MariaDB on socket $MARIADB_SOCKET"; else
      command_available mariadbd || die 'mariadbd is required in prefix mode'
      mariadbd --datadir="$MARIADB_DATA_DIR" --socket="$MARIADB_SOCKET" --pid-file="$MARIADB_DATA_DIR/mariadb.pid" --port="$MARIADB_PORT" --bind-address=127.0.0.1 --daemonize
    fi
  fi
  if ((dry_run)); then plan "create MariaDB database $MARIADB_DATABASE and user $MARIADB_USER"; return; fi
  local db_client=mariadb; command_available "$db_client" || db_client=mysql
  local escaped_password="${MARIADB_PASSWORD//\'/\'\'}"
  local sql="CREATE DATABASE IF NOT EXISTS \`${MARIADB_DATABASE}\`; CREATE USER IF NOT EXISTS '${MARIADB_USER}'@'localhost' IDENTIFIED BY '${escaped_password}'; ALTER USER '${MARIADB_USER}'@'localhost' IDENTIFIED BY '${escaped_password}'; GRANT ALL PRIVILEGES ON \`${MARIADB_DATABASE}\`.* TO '${MARIADB_USER}'@'localhost'; FLUSH PRIVILEGES;"
  local -a args=(--protocol=socket --socket="$MARIADB_SOCKET" -uroot -e "$sql")
  if [[ -n "$MARIADB_ROOT_PASSWORD" ]]; then MYSQL_PWD="$MARIADB_ROOT_PASSWORD" "$db_client" "${args[@]}"; else "$db_client" "${args[@]}"; fi
}

ensure_wp_cli() {
  [[ -x "$WP_CLI_PATH" ]] && { plan "skip wp-cli download: $WP_CLI_PATH exists"; return; }
  if ((dry_run)); then plan "download wp-cli to $WP_CLI_PATH"; return; fi
  command_available curl || die 'curl is required to download wp-cli'
  ensure_dir "$(dirname -- "$WP_CLI_PATH")" 0755
  curl -fsSL "$WP_CLI_URL" -o "$WP_CLI_PATH"; chmod 0755 "$WP_CLI_PATH"; php "$WP_CLI_PATH" --info >/dev/null
}

wp() {
  local -a args=(--path="$WP_PATH")
  [[ "${EUID}" -ne 0 ]] || args+=(--allow-root)
  "$WP_CLI_PATH" "${args[@]}" "$@"
}

ensure_wordpress() {
  local admin_user="${WP_ADMIN_USER:-admin}" admin_password="${WP_ADMIN_PASSWORD:-change-me-in-development}" admin_email="${WP_ADMIN_EMAIL:-admin@example.invalid}"
  ensure_dir "$WP_PATH" 0755
  if [[ ! -f "$WP_PATH/wp-includes/version.php" ]]; then
    if ((dry_run)); then plan "download WordPress $WP_VERSION into $WP_PATH"; else wp core download --version="$WP_VERSION"; fi
  else plan "skip WordPress download: $WP_PATH already contains WordPress"; fi
  if [[ ! -f "$WP_PATH/wp-config.php" ]]; then
    if ((dry_run)); then plan "create wp-config.php for database $MARIADB_DATABASE"; else wp config create --dbname="$MARIADB_DATABASE" --dbuser="$MARIADB_USER" --dbpass="$MARIADB_PASSWORD" --dbhost="$MARIADB_HOST:$MARIADB_PORT" --skip-check; fi
  else plan "skip wp-config.php creation: $WP_PATH/wp-config.php exists"; fi
  if ((dry_run)); then
    plan 'set PLATFORM_CORE_SHARED_SECRET in wp-config.php'
    plan "install WordPress as a subdirectory multisite at $WP_URL"
  else
    if ! grep -q PLATFORM_CORE_SHARED_SECRET "$WP_PATH/wp-config.php"; then
      local secret="${PLATFORM_CORE_SHARED_SECRET//\\/\\\\}"; secret="${secret//\'/\\\'}"
      printf "\ndefine('PLATFORM_CORE_SHARED_SECRET', '%s');\n" "$secret" >> "$WP_PATH/wp-config.php"
    fi
    if ! wp core is-installed --network >/dev/null 2>&1; then
      wp core multisite-install --url="$WP_URL" --title="$WP_TITLE" --admin_user="$admin_user" --admin_password="$admin_password" --admin_email="$admin_email" --subdomains=false --skip-email
    fi
  fi
}

# Database routing drop-in.
#
# NOTE: we use LudicrousDB, NOT HyperDB. HyperDB (unmaintained) is broken on
# modern WordPress: (1) its db.php requires wp-includes/wp-db.php, deprecated
# since WP 6.1, which fatals with "undefined function wp_kses()" during early
# bootstrap; (2) it leaves $wpdb->dbh null, so WooCommerce Action Scheduler's
# $wpdb->db_server_info() fatals and wp-admin dies. LudicrousDB is the
# maintained fork, keeps the same add_database() config API, and was verified
# working on WP 7.0 + WooCommerce (db_server_info + Action Scheduler + admin).
ensure_ludicrousdb() {
  [[ "$LUDICROUSDB_ENABLED" == 0 || "$LUDICROUSDB_ENABLED" == false ]] && { plan 'LudicrousDB disabled by configuration'; return; }
  ensure_dir "$(dirname -- "$LUDICROUSDB_DROPIN_TARGET")" 0755
  ensure_dir "$(dirname -- "$LUDICROUSDB_CONFIG_FILE")" 0755
  if ((dry_run)); then
    plan "download LudicrousDB from $LUDICROUSDB_SOURCE_URL"
    plan "install LudicrousDB package to $LUDICROUSDB_PLUGIN_DIR"
    plan "copy LudicrousDB db.php drop-in to $LUDICROUSDB_DROPIN_TARGET"
    plan "write LudicrousDB single-pool config $LUDICROUSDB_CONFIG_FILE"
    return
  fi

  if [[ -f "$LUDICROUSDB_PLUGIN_DIR/ludicrousdb.php" ]]; then
    plan "skip LudicrousDB download: $LUDICROUSDB_PLUGIN_DIR exists"
  else
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    curl -fsSL -o "$tmp_dir/ludicrousdb.zip" "$LUDICROUSDB_SOURCE_URL" || die 'failed to download LudicrousDB'
    (cd "$tmp_dir" && unzip -q -o ludicrousdb.zip) || die 'failed to unpack LudicrousDB'
    local src_dir
    src_dir="$(find "$tmp_dir" -maxdepth 1 -type d -name 'ludicrousdb-*' | head -1)"
    [[ -n "$src_dir" ]] || die 'LudicrousDB source directory not found after unzip'
    ensure_dir "$LUDICROUSDB_PLUGIN_DIR" 0755
    cp -r "$src_dir/ludicrousdb.php" "$src_dir/ludicrousdb" "$LUDICROUSDB_PLUGIN_DIR/"
    rm -rf -- "$tmp_dir"
  fi

  if [[ -e "$LUDICROUSDB_DROPIN_TARGET" || -L "$LUDICROUSDB_DROPIN_TARGET" ]]; then
    plan "skip LudicrousDB db.php drop-in: $LUDICROUSDB_DROPIN_TARGET exists"
  else
    local dropin="$LUDICROUSDB_PLUGIN_DIR/ludicrousdb/drop-ins/db.php"
    [[ -f "$dropin" ]] || die "LudicrousDB db.php not found: $dropin"
    install -m 0644 "$dropin" "$LUDICROUSDB_DROPIN_TARGET"
  fi

  if [[ -e "$LUDICROUSDB_CONFIG_FILE" || -L "$LUDICROUSDB_CONFIG_FILE" ]]; then
    plan "skip LudicrousDB config: $LUDICROUSDB_CONFIG_FILE exists"
  else
    cat > "$LUDICROUSDB_CONFIG_FILE" <<'EOF'
<?php
// Single-pool baseline. Agent-managed pool mappings can extend this file later.
$wpdb->add_database(array(
    'host' => DB_HOST,
    'user' => DB_USER,
    'password' => DB_PASSWORD,
    'name' => DB_NAME,
    'dataset' => 'global',
    'read' => 1,
    'write' => 1,
));
EOF
    chmod 0644 "$LUDICROUSDB_CONFIG_FILE"
  fi
}

install_plugin_set() {
  [[ "$PLUGIN_SET_ENABLED" == 0 || "$PLUGIN_SET_ENABLED" == false ]] && { plan 'core plugin set disabled by configuration'; return; }
  if ((dry_run)); then
    plan "install core plugin set (including WooCommerce) from $DISTRIBUTION_INSTALLER for $WP_PATH"
    return
  fi
  [[ -x "$DISTRIBUTION_INSTALLER" ]] || die "distribution plugin installer not found or executable: $DISTRIBUTION_INSTALLER"
  local wp_bin_dir
  wp_bin_dir="$(dirname -- "$WP_CLI_PATH")"
  PATH="$wp_bin_dir:$PATH" "$DISTRIBUTION_INSTALLER" --wp-path "$WP_PATH"
}

configure_object_cache() {
  if ((dry_run)); then
    plan "set WP_CACHE, WP_REDIS_HOST=$REDIS_HOST, and WP_REDIS_PORT=$REDIS_PORT"
    if [[ "$PLUGIN_SET_ENABLED" == 0 || "$PLUGIN_SET_ENABLED" == false ]]; then
      plan 'skip wp redis enable because the core plugin set is disabled'
    else
      plan 'enable Redis object-cache drop-in with wp redis enable'
    fi
    return
  fi
  wp config set WP_CACHE true --raw
  wp config set WP_REDIS_HOST "$REDIS_HOST"
  wp config set WP_REDIS_PORT "$REDIS_PORT" --raw
  if [[ "$PLUGIN_SET_ENABLED" == 0 || "$PLUGIN_SET_ENABLED" == false ]]; then
    plan 'skip wp redis enable because the core plugin set is disabled'
  else
    wp redis enable
  fi
}

ensure_mu_plugin() {
  ensure_dir "$(dirname -- "$MU_PLUGIN_TARGET")" 0755
  if [[ -L "$MU_PLUGIN_TARGET" && "$(readlink -- "$MU_PLUGIN_TARGET")" == "$MU_PLUGIN_SOURCE" ]]; then
    plan "skip MU plugin symlink: $MU_PLUGIN_TARGET is current"
  elif [[ -e "$MU_PLUGIN_TARGET" || -L "$MU_PLUGIN_TARGET" ]]; then
    die "refusing to replace existing MU plugin path: $MU_PLUGIN_TARGET"
  elif ((dry_run)); then plan "symlink MU plugin $MU_PLUGIN_SOURCE -> $MU_PLUGIN_TARGET";
  else [[ -f "$MU_PLUGIN_SOURCE" ]] || die "MU plugin source not found: $MU_PLUGIN_SOURCE"; ln -s "$MU_PLUGIN_SOURCE" "$MU_PLUGIN_TARGET"; fi
}

ensure_php_fpm() {
  [[ "$mode" == system ]] || { plan 'prefix mode leaves PHP-FPM startup to the developer environment'; return; }
  if ((dry_run)); then plan 'enable and start the installed PHP-FPM service'; return; fi
  if [[ -z "$PHP_FPM_SERVICE" ]]; then PHP_FPM_SERVICE="$(systemctl list-unit-files 'php*-fpm.service' --no-legend 2>/dev/null | awk 'NR == 1 {print $1}')"; fi
  [[ -n "$PHP_FPM_SERVICE" ]] || die 'could not find a PHP-FPM service; set PHP_FPM_SERVICE'
  systemctl enable --now "$PHP_FPM_SERVICE"
}

ensure_caddy() {
  if ((dry_run)); then plan "write Caddy site config $CADDY_CONFIG_FILE if absent";
  elif [[ ! -f "$CADDY_CONFIG_FILE" ]]; then
    ensure_dir "$(dirname -- "$CADDY_CONFIG_FILE")" 0755
    printf '%s\n' "$CADDY_SITE_ADDRESS {" "    root * $WP_PATH" "    php_fastcgi $PHP_FPM_ADDRESS" '    file_server' '}' > "$CADDY_CONFIG_FILE"
  fi
  if [[ "$mode" == system ]]; then
    if ((dry_run)); then plan "enable and start Caddy service $CADDY_SERVICE"; else systemctl enable --now "$CADDY_SERVICE"; fi
  else plan 'prefix mode leaves Caddy startup to the developer environment'; fi
}

write_agent_env() {
  local token="${PLATFORM_AGENT_WORDPRESS_AUTH_TOKEN:-$PLATFORM_CORE_SHARED_SECRET}"
  if ((dry_run)); then plan "write agent environment $AGENT_CONFIG_DIR/agent.env (0600; secrets omitted)"; return; fi
  umask 077
  printf '%s\n' \
    "PLATFORM_AGENT_CONTROL_PLANE_URL=${PLATFORM_AGENT_CONTROL_PLANE_URL:-}" \
    "PLATFORM_AGENT_ID=${PLATFORM_AGENT_ID:-}" \
    "PLATFORM_AGENT_AUTH_TOKEN=${PLATFORM_AGENT_AUTH_TOKEN:-}" \
    "PLATFORM_AGENT_REGISTRATION_TOKEN=${PLATFORM_AGENT_REGISTRATION_TOKEN:-}" \
    "PLATFORM_AGENT_NODE_ID=${PLATFORM_AGENT_NODE_ID:-}" \
    "PLATFORM_AGENT_CAPABILITIES=${PLATFORM_AGENT_CAPABILITIES:-{}}" \
    "PLATFORM_AGENT_VERSIONS=${PLATFORM_AGENT_VERSIONS:-{}}" \
    "PLATFORM_AGENT_WORDPRESS_URL=${PLATFORM_AGENT_WORDPRESS_URL:-http://127.0.0.1}" \
    "PLATFORM_AGENT_WORDPRESS_AUTH_TOKEN=$token" > "$AGENT_CONFIG_DIR/agent.env"
  chmod 0600 "$AGENT_CONFIG_DIR/agent.env"
  [[ "$mode" != system ]] || chown "$AGENT_SERVICE_USER:$AGENT_SERVICE_GROUP" "$AGENT_CONFIG_DIR/agent.env"
}

install_agent() {
  if [[ ! -f "$AGENT_BINARY" ]]; then
    if ((dry_run)); then plan "build platform-agent from $repo_root/apps/agent or use AGENT_BINARY";
    else command_available go || die "agent binary not found and go is unavailable: $AGENT_BINARY"; local build_dir="$NODE_PREFIX/var/lib/platform-agent"; ensure_dir "$build_dir" 0750; AGENT_BINARY="$build_dir/platform-agent"; (cd "$repo_root" && go build -o "$AGENT_BINARY" ./apps/agent); fi
  fi
  ensure_dir "$AGENT_CONFIG_DIR" 0750; ensure_dir "$(dirname -- "$AGENT_INSTALL_PATH")" 0755
  if ((dry_run)); then plan "install platform-agent as $AGENT_INSTALL_PATH"; else [[ -f "$AGENT_BINARY" ]] || die "agent binary not found: $AGENT_BINARY"; install -m 0755 "$AGENT_BINARY" "$AGENT_INSTALL_PATH"; fi
  if [[ "$mode" == system ]]; then
    if ((dry_run)); then plan "create service account $AGENT_SERVICE_USER and install systemd unit $SERVICE_FILE";
    else
      getent group "$AGENT_SERVICE_GROUP" >/dev/null 2>&1 || groupadd --system "$AGENT_SERVICE_GROUP"
      id "$AGENT_SERVICE_USER" >/dev/null 2>&1 || useradd --system --gid "$AGENT_SERVICE_GROUP" --home-dir /var/lib/platform-agent --create-home --shell /usr/sbin/nologin "$AGENT_SERVICE_USER"
    fi
  fi
  write_agent_env
  if ((dry_run)); then plan "install systemd unit $SERVICE_FILE";
  else
    ensure_dir "$(dirname -- "$SERVICE_FILE")" 0755
    local service_user="$AGENT_SERVICE_USER" service_group="$AGENT_SERVICE_GROUP"
    if [[ "$mode" == prefix ]]; then service_user="${SUDO_USER:-$(id -un)}"; service_group="$(id -gn "$service_user")"; fi
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=WooCommerce Cloud platform agent
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$service_user
Group=$service_group
ExecStart=$AGENT_INSTALL_PATH
EnvironmentFile=-$AGENT_CONFIG_DIR/agent.env
Restart=on-failure
RestartSec=5s
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=true
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
EOF
  fi
  if [[ "$mode" == system ]]; then
    if ((dry_run)); then plan "reload and enable $AGENT_SERVICE_NAME with systemd"; else systemctl daemon-reload; systemctl enable "$AGENT_SERVICE_NAME"; fi
  else plan 'prefix mode writes the unit but does not invoke systemd'; fi
}

main() {
  validate_settings
  [[ "$mode" != system || "${EUID}" -eq 0 || $dry_run -eq 1 ]] || die 'system mode must run as root; use --prefix for an unprivileged install'
  ensure_dependencies; ensure_mariadb; ensure_redis; ensure_wp_cli; ensure_wordpress; ensure_ludicrousdb; install_plugin_set; configure_object_cache; ensure_mu_plugin; ensure_php_fpm; ensure_caddy; install_agent
  if ((dry_run)); then plan "node provisioning plan complete (mode=$mode, prefix=$NODE_PREFIX)"; else printf 'node provisioning complete: %s mode at %s\n' "$mode" "$NODE_PREFIX"; fi
}
main "$@"

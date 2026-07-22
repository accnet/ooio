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
  MYSQL_DATA_DIR="${MYSQL_DATA_DIR:-${MARIADB_DATA_DIR:-$var_root/lib/mysql}}"
  MYSQL_SOCKET="${MYSQL_SOCKET:-${MARIADB_SOCKET:-$run_root/mysqld/mysqld.sock}}"
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
  MYSQL_DATA_DIR="${MYSQL_DATA_DIR:-${MARIADB_DATA_DIR:-/var/lib/mysql}}"
  MYSQL_SOCKET="${MYSQL_SOCKET:-${MARIADB_SOCKET:-/run/mysqld/mysqld.sock}}"
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
MYSQL_HOST="${MYSQL_HOST:-${MARIADB_HOST:-127.0.0.1}}"; MYSQL_PORT="${MYSQL_PORT:-${MARIADB_PORT:-3306}}"
MYSQL_DATABASE="${MYSQL_DATABASE:-${MARIADB_DATABASE:-wordpress}}"; MYSQL_USER="${MYSQL_USER:-${MARIADB_USER:-wordpress}}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-${MARIADB_PASSWORD:-change-me-in-development}}"; MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-${MARIADB_ROOT_PASSWORD:-}}"
OOIO_EXPECTED_STORES_PER_NODE="${OOIO_EXPECTED_STORES_PER_NODE:-200}"
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
MYSQL_CONFIG_FILE="${MYSQL_CONFIG_FILE:-${MARIADB_CONFIG_FILE:-$etc_root/mysql/mysql.conf.d/60-ooio.cnf}}"
MYSQL_SYSTEMD_DROPIN="${MYSQL_SYSTEMD_DROPIN:-${MARIADB_SYSTEMD_DROPIN:-$etc_root/systemd/system/mysql.service.d/60-ooio-limits.conf}}"
OOIO_SYSCTL_FILE="${OOIO_SYSCTL_FILE:-$etc_root/sysctl.d/60-ooio-mysql.conf}"
OOIO_MYSQL_LIMITS_CHANGED=0

plan() { ((dry_run)) && printf '[dry-run] %s\n' "$*" || :; }
run() { ((dry_run)) || "$@"; }
command_available() { command -v "$1" >/dev/null 2>&1; }

validate_settings() {
  [[ "$MYSQL_DATABASE" =~ ^[A-Za-z0-9_]+$ ]] || die 'MYSQL_DATABASE has invalid characters'
  [[ "$MYSQL_USER" =~ ^[A-Za-z0-9_]+$ ]] || die 'MYSQL_USER has invalid characters'
  [[ "$MYSQL_PORT" =~ ^[0-9]+$ ]] || die 'MYSQL_PORT must be numeric'
  [[ "$REDIS_PORT" =~ ^[0-9]+$ ]] || die 'REDIS_PORT must be numeric'
  [[ "$OOIO_EXPECTED_STORES_PER_NODE" =~ ^[1-9][0-9]*$ ]] || die 'OOIO_EXPECTED_STORES_PER_NODE must be a positive integer'
  if (( !dry_run )); then
    [[ -n "$PLATFORM_CORE_SHARED_SECRET" ]] || die 'PLATFORM_CORE_SHARED_SECRET is required outside dry-run'
    [[ "$PLATFORM_CORE_SHARED_SECRET" != change-me-* ]] || die 'replace the development shared secret before installing'
  fi
}

ensure_dir() { if ((dry_run)); then plan "create directory $1"; else install -d -m "${2:-0755}" "$1"; fi; }

write_managed_file() {
  local target="$1" mode="$2" temp_file
  temp_file="$(mktemp "${target}.tmp.XXXXXX")"
  cat > "$temp_file"
  chmod "$mode" "$temp_file"
  if [[ ! -e "$target" ]] || ! cmp -s "$temp_file" "$target"; then
    install -m "$mode" "$temp_file" "$target"
    OOIO_MYSQL_LIMITS_CHANGED=1
  fi
  rm -f -- "$temp_file"
}

ensure_dependencies() {
  local packages=(mysql-server mysql-client php php-cli php-curl php-mbstring php-mysql php-xml php-fpm caddy curl ca-certificates unzip python3 procps "$REDIS_PACKAGE")
  local missing=() name
  for name in curl unzip php python3 redis-server sysctl; do command_available "$name" || missing+=("$name"); done
  command_available mysql || missing+=(mysql)
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

calculate_mysql_limits() {
  # Spike #002 measured 50 hot tables per WooCommerce store. Keep the 1.2x
  # safety factor explicit: table_open_cache = stores * 50 * 1.2.
  OOIO_TABLES_PER_STORE=50
  OOIO_TABLE_OPEN_CACHE=$((OOIO_EXPECTED_STORES_PER_NODE * OOIO_TABLES_PER_STORE * 12 / 10))
  OOIO_OPEN_FILES_LIMIT=$((OOIO_TABLE_OPEN_CACHE * 2))
  # Leave process-level headroom for MySQL's own descriptors and connections.
  OOIO_MYSQL_LIMIT_NOFILE=$((OOIO_OPEN_FILES_LIMIT * 2))
  OOIO_SYSCTL_NR_OPEN="$OOIO_MYSQL_LIMIT_NOFILE"
  OOIO_SYSCTL_FILE_MAX="$OOIO_MYSQL_LIMIT_NOFILE"
}

write_mysql_limits() {
  calculate_mysql_limits
  ensure_dir "$(dirname -- "$MYSQL_CONFIG_FILE")" 0755
  ensure_dir "$(dirname -- "$MYSQL_SYSTEMD_DROPIN")" 0755
  ensure_dir "$(dirname -- "$OOIO_SYSCTL_FILE")" 0755
  if (( !dry_run )) && [[ "$mode" == system ]]; then
    local current_nr_open current_file_max
    current_nr_open="$(sysctl -n fs.nr_open)" || die 'could not read fs.nr_open before applying MySQL limits'
    current_file_max="$(sysctl -n fs.file-max)" || die 'could not read fs.file-max before applying MySQL limits'
    [[ "$current_nr_open" =~ ^[0-9]+$ && "$current_file_max" =~ ^[0-9]+$ ]] || die "kernel fd limits are not numeric (nr_open=$current_nr_open file-max=$current_file_max)"
    (( current_nr_open > OOIO_SYSCTL_NR_OPEN )) && OOIO_SYSCTL_NR_OPEN="$current_nr_open"
    (( current_file_max > OOIO_SYSCTL_FILE_MAX )) && OOIO_SYSCTL_FILE_MAX="$current_file_max"
  fi
  if ((dry_run)); then
    plan "write MySQL limits to $MYSQL_CONFIG_FILE (table_open_cache=$OOIO_TABLE_OPEN_CACHE, open_files_limit=$OOIO_OPEN_FILES_LIMIT)"
    plan "write MySQL systemd LimitNOFILE=$OOIO_MYSQL_LIMIT_NOFILE to $MYSQL_SYSTEMD_DROPIN"
    plan "write kernel fd limits (fs.nr_open/fs.file-max) to $OOIO_SYSCTL_FILE"
    return
  fi
  write_managed_file "$MYSQL_CONFIG_FILE" 0644 <<EOF
# Managed by ooio install-node.sh. See Spike #002 table-cache report.
# Formula: OOIO_EXPECTED_STORES_PER_NODE * 50 hot tables/store * 1.2 safety factor.
[mysqld]
table_open_cache=$OOIO_TABLE_OPEN_CACHE
open_files_limit=$OOIO_OPEN_FILES_LIMIT
EOF
  write_managed_file "$MYSQL_SYSTEMD_DROPIN" 0644 <<EOF
# Managed by ooio install-node.sh. Keep the process limit above MySQL's table cache.
[Service]
LimitNOFILE=$OOIO_MYSQL_LIMIT_NOFILE
EOF
write_managed_file "$OOIO_SYSCTL_FILE" 0644 <<EOF
# Managed by ooio install-node.sh. Required for MySQL table/file descriptor capacity.
fs.nr_open = $OOIO_SYSCTL_NR_OPEN
fs.file-max = $OOIO_SYSCTL_FILE_MAX
EOF
}

apply_kernel_limits() {
  if ((dry_run)); then
    if [[ "$mode" == system ]]; then
      plan "apply kernel fd limits from $OOIO_SYSCTL_FILE"
    else
      plan "prefix mode writes kernel fd limits to $OOIO_SYSCTL_FILE but cannot change the host kernel"
    fi
  elif [[ "$mode" == system ]]; then
    command_available sysctl || die 'sysctl is required to apply MySQL fd limits'
    sysctl -p "$OOIO_SYSCTL_FILE" >/dev/null
  else
    plan "prefix mode cannot change host kernel limits; verify fs.nr_open and fs.file-max before starting MySQL"
  fi
}

verify_kernel_limits() {
  if ((dry_run)); then
    plan "verify fs.nr_open and fs.file-max >= $OOIO_MYSQL_LIMIT_NOFILE"
    return
  fi
  local nr_open file_max
  nr_open="$(sysctl -n fs.nr_open)" || die 'could not read fs.nr_open after applying MySQL limits'
  file_max="$(sysctl -n fs.file-max)" || die 'could not read fs.file-max after applying MySQL limits'
  [[ "$nr_open" =~ ^[0-9]+$ && "$file_max" =~ ^[0-9]+$ ]] || die "kernel fd limits are not numeric (nr_open=$nr_open file-max=$file_max)"
  (( nr_open >= OOIO_MYSQL_LIMIT_NOFILE )) || die "fs.nr_open=$nr_open is below required $OOIO_MYSQL_LIMIT_NOFILE"
  (( file_max >= OOIO_MYSQL_LIMIT_NOFILE )) || die "fs.file-max=$file_max is below required $OOIO_MYSQL_LIMIT_NOFILE"
}

verify_mysql_limits() {
  if ((dry_run)); then
    plan "verify MySQL @@table_open_cache >= $OOIO_TABLE_OPEN_CACHE and @@open_files_limit >= $OOIO_OPEN_FILES_LIMIT"
    return
  fi
  local db_client=mysql actual_table_cache actual_open_files
  local -a args=(--protocol=socket --socket="$MYSQL_SOCKET" -uroot -N -B -e 'SELECT @@table_open_cache, @@open_files_limit;')
  local limits
  if [[ -n "$MYSQL_ROOT_PASSWORD" ]]; then
    limits="$(MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$db_client" "${args[@]}")" || die 'could not read MySQL runtime limits'
  else
    limits="$($db_client "${args[@]}")" || die 'could not read MySQL runtime limits'
  fi
  read -r actual_table_cache actual_open_files <<< "$limits"
  [[ "$actual_table_cache" =~ ^[0-9]+$ && "$actual_open_files" =~ ^[0-9]+$ ]] || die "MySQL returned invalid runtime limits: $limits"
  (( actual_table_cache >= OOIO_TABLE_OPEN_CACHE )) || die "MySQL lowered table_open_cache to $actual_table_cache; required $OOIO_TABLE_OPEN_CACHE"
  (( actual_open_files >= OOIO_OPEN_FILES_LIMIT )) || die "MySQL lowered open_files_limit to $actual_open_files; required $OOIO_OPEN_FILES_LIMIT"
  plan "MySQL limits verified (table_open_cache=$actual_table_cache, open_files_limit=$actual_open_files)"
}

ensure_mysql() {
  write_mysql_limits
  apply_kernel_limits
  ensure_dir "$MYSQL_DATA_DIR" 0750; ensure_dir "$(dirname -- "$MYSQL_SOCKET")" 0755
  if [[ ! -d "$MYSQL_DATA_DIR/mysql" ]]; then
    if ((dry_run)); then plan "initialize MySQL datadir $MYSQL_DATA_DIR"; else
      command_available mysqld || die 'mysqld is required to initialize the MySQL datadir'
      mysqld --initialize-insecure --datadir="$MYSQL_DATA_DIR"
    fi
  else
    plan "skip MySQL datadir initialization: $MYSQL_DATA_DIR/mysql exists"
  fi
  if [[ "$mode" == system ]]; then
    if ((dry_run)); then
      plan 'reload systemd and enable/start MySQL with the managed fd limit'
    else
      systemctl daemon-reload
      if systemctl is-active --quiet mysql; then
        if (( OOIO_MYSQL_LIMITS_CHANGED )); then systemctl restart mysql; else plan 'MySQL is already running with the managed limits'; fi
      else
        systemctl enable --now mysql
      fi
    fi
  elif [[ ! -S "$MYSQL_SOCKET" ]]; then
    if ((dry_run)); then plan "start local MySQL on socket $MYSQL_SOCKET"; else
      command_available mysqld || die 'mysqld is required in prefix mode'
      mysqld --defaults-extra-file="$MYSQL_CONFIG_FILE" --datadir="$MYSQL_DATA_DIR" --socket="$MYSQL_SOCKET" --pid-file="$MYSQL_DATA_DIR/mysql.pid" --port="$MYSQL_PORT" --bind-address=127.0.0.1 --daemonize
    fi
  fi
  verify_kernel_limits
  verify_mysql_limits
  if ((dry_run)); then plan "create MySQL database $MYSQL_DATABASE and user $MYSQL_USER"; return; fi
  local escaped_password="${MYSQL_PASSWORD//\'/\'\'}"
  local sql="CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\`; CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'localhost' IDENTIFIED BY '${escaped_password}'; ALTER USER '${MYSQL_USER}'@'localhost' IDENTIFIED BY '${escaped_password}'; GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '${MYSQL_USER}'@'localhost'; FLUSH PRIVILEGES;"
  local -a args=(--protocol=socket --socket="$MYSQL_SOCKET" -uroot -e "$sql")
  if [[ -n "$MYSQL_ROOT_PASSWORD" ]]; then MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql "${args[@]}"; else mysql "${args[@]}"; fi
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
    if ((dry_run)); then plan "create wp-config.php for database $MYSQL_DATABASE"; else wp config create --dbname="$MYSQL_DATABASE" --dbuser="$MYSQL_USER" --dbpass="$MYSQL_PASSWORD" --dbhost="$MYSQL_HOST:$MYSQL_PORT" --skip-check; fi
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
  ensure_dependencies; ensure_mysql; ensure_redis; ensure_wp_cli; ensure_wordpress; ensure_ludicrousdb; install_plugin_set; configure_object_cache; ensure_mu_plugin; ensure_php_fpm; ensure_caddy; install_agent
  if ((dry_run)); then plan "node provisioning plan complete (mode=$mode, prefix=$NODE_PREFIX)"; else printf 'node provisioning complete: %s mode at %s\n' "$mode" "$NODE_PREFIX"; fi
}
main "$@"

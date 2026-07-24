<?php
/**
 * Plugin Name: Platform Core
 * Description: Localhost-only WordPress data-plane REST skeleton.
 */

defined('ABSPATH') || exit;

$platform_core_autoload = __DIR__ . '/vendor/autoload.php';
if (is_readable($platform_core_autoload)) {
    require_once $platform_core_autoload;
} else {
    spl_autoload_register(static function ($class) {
        $prefix = 'PlatformCore\\';
        if (strpos($class, $prefix) !== 0) {
            return;
        }

        $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
        $file = __DIR__ . '/src/' . $relative . '.php';
        if (is_readable($file)) {
            require_once $file;
        }
    });
}

add_action('rest_api_init', static function () {
    $adapter = new \PlatformCore\Adapter\CoreWordPressAdapter();
    $service = new \PlatformCore\Service\SiteService($adapter);
    $controller = new \PlatformCore\Rest\Controller($service);
    $controller->register_routes();
    platform_core_register_store_notice_route();
});

// ─────────────────────────────────────────────────────────────────────────────
// MEASURED 2026-07-23 — BOTH FILTERS BELOW ARE UNNECESSARY. Left registered=off.
//
// The premise was: "/shop/ cannot be cached because two visitors get different
// HTML". That framed the wrong question. What a page cache actually needs is:
// "can an anonymous page be stored once and served to anonymous visitors?"
//
// Measured: three independent anonymous sessions fetched /shop/ and produced
// ZERO differing lines. The page is byte-identical for visitors without a cart.
//
// Visitors WITH a cart are identifiable by cookie — `woocommerce_items_in_cart`
// and `woocommerce_cart_hash` — and WooCommerce already calls nocache_headers()
// for them (BlocksSharedState.php:112). That is an explicit design signal: do
// not serve a cached page to someone holding a cart.
//
// So the correct architecture is cache-bypass on cookie, not making the HTML
// visitor-neutral. Neutralising it would mean serving ONE entry to both groups —
// exactly what WooCommerce says not to do — and it costs real behaviour:
// deferring notices adds a REST round-trip to every page, and neutralising the
// Add-to-Cart button gives no-JS visitors a wrong button state.
//
// Kept, not deleted: the services and their tests are correct, and a future
// edge-cache that cannot vary on cookies would need exactly this.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keep flash notices out of shared storefront HTML while preserving WooCommerce
 * notice rendering on cart and checkout.
 */
function platform_core_should_defer_store_notices()
{
    return \PlatformCore\Service\StoreNoticeService::shouldDefer(array(
        'is_admin' => function_exists('is_admin') && is_admin(),
        'doing_ajax' => function_exists('wp_doing_ajax') && wp_doing_ajax(),
        'is_rest' => defined('REST_REQUEST') && REST_REQUEST,
        'is_cart' => function_exists('is_cart') && is_cart(),
        'is_checkout' => function_exists('is_checkout') && is_checkout(),
    ));
}

function platform_core_defer_store_notices()
{
    if (!platform_core_should_defer_store_notices()) {
        return;
    }

    // Classic themes render notices through these action hooks.
    foreach (array('woocommerce_before_shop_loop', 'woocommerce_before_single_product', 'woocommerce_before_main_content') as $hook) {
        remove_action($hook, 'woocommerce_output_all_notices', 10);
    }
}
add_action('wp', 'platform_core_defer_store_notices', 20);

/**
 * Block themes do NOT use the action hooks above — they render notices through
 * the `woocommerce/store-notices` block, so removing the actions has no effect.
 * Measured on twentytwentyfive: `/shop/` still carried the notice banner and the
 * page stayed uncacheable.
 *
 * `pre_render_block` runs BEFORE the block's render callback. That matters:
 * `render_block` would arrive after the callback had already called
 * `wc_print_notices()`, which CONSUMES the queue — the deferred fetch would then
 * find nothing and the notice would be lost rather than moved.
 */
function platform_core_skip_store_notices_block($pre_render, $parsed_block)
{
    if ($pre_render !== null) {
        return $pre_render;
    }
    if (!isset($parsed_block['blockName']) || $parsed_block['blockName'] !== 'woocommerce/store-notices') {
        return $pre_render;
    }
    if (!platform_core_should_defer_store_notices()) {
        return $pre_render;
    }

    // Empty string, not the container: the loader in wp_footer owns the markup,
    // so the notice appears in exactly one place whichever path rendered it.
    return '';
}
// Deferring the block is only safe because the endpoint above now loads the
// WooCommerce session. An earlier revision registered this filter WITHOUT that
// fix: the notice was suppressed on the page and the deferred fetch returned
// `{"html":""}`, so the notice was lost rather than moved. Verify the endpoint
// returns notice HTML before trusting this path.
// add_filter('pre_render_block', 'platform_core_skip_store_notices_block', 10, 2);

/**
 * Strip visitor-specific cart state out of product buttons so the storefront HTML
 * is byte-identical for everyone and can be served from one cache entry.
 *
 * `render_block`, not `pre_render_block`: here we WANT the block to render and
 * then edit its output. Short-circuiting would remove the button entirely.
 */
function platform_core_neutralise_product_button($block_content, $parsed_block)
{
    if (!isset($parsed_block['blockName']) || $parsed_block['blockName'] !== 'woocommerce/product-button') {
        return $block_content;
    }
    if (!platform_core_should_defer_store_notices()) {
        return $block_content;
    }

    return \PlatformCore\Service\ProductButtonService::neutralise($block_content);
}
// add_filter('render_block', 'platform_core_neutralise_product_button', 10, 2);

function platform_core_register_store_notice_route()
{
    register_rest_route('platform-core/v1', '/notices', array(
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'platform_core_store_notice_response',
    ));
}

function platform_core_store_notice_response()
{
    if (function_exists('nocache_headers')) {
        nocache_headers();
    }

    // WooCommerce only calls wc_load_cart() for FRONTEND requests, and
    // WC_Woocommerce::is_request('frontend') excludes REST explicitly
    // (`&& ! $this->is_rest_api_request()`, class-woocommerce.php:660). Without
    // it `WC()->session` is null and wc_get_notices() returns an empty array
    // (wc-notice-functions.php:248) — which is why an earlier revision of this
    // endpoint answered `{"html":""}` while the page itself had notices.
    //
    // Same guard WooCommerce's own Store API uses (CartController::load_cart).
    if (function_exists('wc_load_cart') && !did_action('woocommerce_load_cart_from_session')) {
        wc_load_cart();
    }

    $html = function_exists('wc_print_notices') ? (string) wc_print_notices(true) : '';
    $response = new WP_REST_Response(array('html' => $html), 200);
    foreach (\PlatformCore\Service\StoreNoticeService::cacheHeaders() as $name => $value) {
        $response->header($name, $value);
    }

    return $response;
}

function platform_core_print_store_notice_loader()
{
    if (!platform_core_should_defer_store_notices()) {
        return;
    }

    $endpoint = function_exists('rest_url') ? rest_url('platform-core/v1/notices') : '/wp-json/platform-core/v1/notices';
    echo '<div id="platform-core-store-notices" aria-live="polite"></div>';
    echo '<script>' . \PlatformCore\Service\StoreNoticeService::clientScript($endpoint) . '</script>';
}
add_action('wp_footer', 'platform_core_print_store_notice_loader', 99);

/**
 * Platform-managed static page cache (SA48). WRITE on a cacheable anonymous
 * render, INVALIDATE when catalog data changes. The serving side is Caddy
 * (Spike #013); this side keeps the files correct.
 *
 * OOIO_STATIC_CACHE_ROOT selects the directory Caddy also serves from. Absent,
 * the cache is inert — nothing is written and nothing breaks.
 */
function platform_core_static_cache()
{
    static $service = null;
    if ($service === null) {
        $root = getenv('OOIO_STATIC_CACHE_ROOT');
        if (!$root && defined('OOIO_STATIC_CACHE_ROOT')) {
            $root = OOIO_STATIC_CACHE_ROOT;
        }
        $service = $root ? new \PlatformCore\Service\StaticCacheService($root) : false;
    }
    return $service;
}

/**
 * Start buffering an anonymous front-end page so its HTML can be stored at
 * shutdown. Bail early for anything that must never be cached — admin, REST,
 * AJAX, non-GET, or a request already carrying a bypass cookie.
 */
function platform_core_cache_begin_buffer()
{
    if (!platform_core_static_cache()) {
        return;
    }
    if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
        return;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET' || !empty($_GET)) {
        return;
    }
    foreach (array_keys($_COOKIE) as $cookieName) {
        if (\PlatformCore\Service\StaticCacheService::isBypassCookie($cookieName)) {
            return;
        }
    }
    // is_cart/is_checkout/is_account_page are visitor-specific by nature.
    if ((function_exists('is_cart') && is_cart())
        || (function_exists('is_checkout') && is_checkout())
        || (function_exists('is_account_page') && is_account_page())) {
        return;
    }
    ob_start('platform_core_cache_capture');
}
add_action('template_redirect', 'platform_core_cache_begin_buffer', 0);

/**
 * ob_start callback: returns the body unchanged, and writes it to the cache if
 * the final response turned out to be storable. Runs at buffer close, so
 * http_response_code() and headers_list() reflect the real response.
 */
function platform_core_cache_capture($html)
{
    $service = platform_core_static_cache();
    if (!$service) {
        return $html;
    }
    $setsCookie = false;
    foreach (headers_list() as $header) {
        if (stripos($header, 'set-cookie:') === 0) {
            $setsCookie = true;
            break;
        }
    }
    $context = array(
        'method' => $_SERVER['REQUEST_METHOD'] ?? 'GET',
        'status' => function_exists('http_response_code') ? (int) http_response_code() : 200,
        'cookies' => $_COOKIE,
        'sets_cookie' => $setsCookie,
        // A rendered notice means the page reflects a visitor action, not shared state.
        // A rendered notice carries a state modifier — is-success / is-error /
        // is-info. The bare class name also appears in inline CSS and in an empty
        // <template> block on every shop page (measured: anonymous shop has the
        // class 5 times but the is- modifier 0 times), so matching the bare name
        // would make every page look visitor-specific and nothing would cache.
        'has_notice' => (bool) preg_match('/wc-block-components-notice-banner is-(success|error|info)/', $html),
    );
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $service->write($path, $html, $context);
    return $html;
}

/**
 * Invalidate on catalog change. Deletes the whole cache rather than guessing
 * which pages a product touches — see StaticCacheService::invalidateAll.
 */
function platform_core_cache_invalidate()
{
    $service = platform_core_static_cache();
    if ($service) {
        $service->invalidateAll();
    }
}
foreach (array('save_post_product', 'woocommerce_update_product', 'woocommerce_new_product', 'woocommerce_product_set_stock', 'woocommerce_variation_set_stock', 'updated_option') as $cacheHook) {
    add_action($cacheHook, 'platform_core_cache_invalidate', 10, 0);
}

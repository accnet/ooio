<?php

define('ABSPATH', __DIR__);

function add_action($hook, $callback, $priority = 10)
{
    $GLOBALS['store_notice_actions'][] = array($hook, $callback, $priority);
}

function register_rest_route($namespace, $route, $args)
{
    $GLOBALS['store_notice_routes'][] = array($namespace, $route, $args);
}

function remove_action($hook, $callback, $priority = 10)
{
    $GLOBALS['store_notice_removed'][] = array($hook, $callback, $priority);
}

function add_filter($hook, $callback, $priority = 10, $accepted_args = 1)
{
    $GLOBALS['store_notice_filters'][] = array($hook, $callback, $priority, $accepted_args);
}

function is_admin() { return !empty($GLOBALS['store_notice_context']['is_admin']); }
function wp_doing_ajax() { return !empty($GLOBALS['store_notice_context']['doing_ajax']); }
function is_cart() { return !empty($GLOBALS['store_notice_context']['is_cart']); }
function is_checkout() { return !empty($GLOBALS['store_notice_context']['is_checkout']); }
function nocache_headers() { $GLOBALS['store_notice_nocache_called'] = true; }
function wc_print_notices($return) { return '<div class="woocommerce-message">Added to cart</div>'; }

final class WP_REST_Response
{
    public $data;
    public $status;
    public $headers = array();

    public function __construct($data, $status)
    {
        $this->data = $data;
        $this->status = $status;
    }

    public function header($name, $value)
    {
        $this->headers[$name] = $value;
    }
}

require_once __DIR__ . '/../src/Service/StoreNoticeService.php';
require_once __DIR__ . '/../platform-core.php';

use PlatformCore\Service\StoreNoticeService;

final class StoreNoticeServiceTest
{
    public static function run()
    {
        self::assertBlockPathDeferred();
        self::defersOnlyForRegularStorefrontRequests();
        self::wiresStorefrontDeferWithoutTouchingCartOrCheckout();
        self::returnsUncacheableRestResponse();
        self::returnsNoStoreHeaders();
        self::generatesSessionAwareClientLoader();
    }

    private static function wiresStorefrontDeferWithoutTouchingCartOrCheckout()
    {
        $GLOBALS['store_notice_context'] = array();
        $GLOBALS['store_notice_removed'] = array();
        platform_core_defer_store_notices();
        self::same(3, count($GLOBALS['store_notice_removed']), 'storefront notice hooks removed');

        $GLOBALS['store_notice_context'] = array('is_cart' => true);
        $GLOBALS['store_notice_removed'] = array();
        platform_core_defer_store_notices();
        self::same(0, count($GLOBALS['store_notice_removed']), 'cart notice hooks preserved');

        $GLOBALS['store_notice_context'] = array('is_checkout' => true);
        platform_core_defer_store_notices();
        self::same(0, count($GLOBALS['store_notice_removed']), 'checkout notice hooks preserved');
    }

    private static function returnsUncacheableRestResponse()
    {
        $GLOBALS['store_notice_nocache_called'] = false;
        $response = platform_core_store_notice_response();

        self::same(200, $response->status, 'notice response status');
        self::same('<div class="woocommerce-message">Added to cart</div>', $response->data['html'], 'notice response html');
        self::same(true, $GLOBALS['store_notice_nocache_called'], 'WordPress nocache headers');
        self::same('private, no-store, no-cache, must-revalidate, max-age=0', $response->headers['Cache-Control'], 'REST cache control');
    }

    private static function defersOnlyForRegularStorefrontRequests()
    {
        self::same(true, StoreNoticeService::shouldDefer(array()), 'regular storefront request');

        foreach (array('is_admin', 'doing_ajax', 'is_rest', 'is_cart', 'is_checkout') as $flag) {
            self::same(false, StoreNoticeService::shouldDefer(array($flag => true)), $flag . ' request');
        }
    }

    private static function returnsNoStoreHeaders()
    {
        $headers = StoreNoticeService::cacheHeaders();

        self::same('private, no-store, no-cache, must-revalidate, max-age=0', $headers['Cache-Control'], 'cache control');
        self::same('Cookie', $headers['Vary'], 'vary header');
        self::same('0', $headers['Expires'], 'expires header');
    }

    private static function generatesSessionAwareClientLoader()
    {
        $script = StoreNoticeService::clientScript('/wp-json/platform-core/v1/notices');

        self::contains('/wp-json/platform-core/v1/notices', $script, 'notice endpoint');
        self::contains("credentials: 'same-origin'", $script, 'session credentials');
        self::contains("cache: 'no-store'", $script, 'client cache policy');
        self::contains('platform-core-store-notices', $script, 'notice container');
    }

    private static function same($expected, $actual, $message)
    {
        if ($expected !== $actual) {
            throw new RuntimeException($message . ': values differ.');
        }
    }

    /**
     * Block themes render notices through `woocommerce/store-notices`, not the
     * classic action hooks. Measured on twentytwentyfive 2026-07-23: removing the
     * actions alone left `/shop/` uncacheable (67 differing lines, unchanged), so
     * this is the path that actually decides the outcome.
     */
    private static function assertBlockPathDeferred()
    {
        $notices = array('blockName' => 'woocommerce/store-notices');

        $GLOBALS['store_notice_context'] = array();
        self::same('', platform_core_skip_store_notices_block(null, $notices),
            'store-notices block must be short-circuited when deferring');

        self::same(null, platform_core_skip_store_notices_block(null, array('blockName' => 'core/paragraph')),
            'unrelated blocks must render untouched');

        $GLOBALS['store_notice_context'] = array('is_checkout' => true);
        self::same(null, platform_core_skip_store_notices_block(null, $notices),
            'checkout must keep rendering notices inline');

        $GLOBALS['store_notice_context'] = array();
        self::same('already', platform_core_skip_store_notices_block('already', $notices),
            'a non-null pre_render from another filter must be preserved');
    }

    private static function contains($needle, $haystack, $message)
    {
        if (strpos($haystack, $needle) === false) {
            throw new RuntimeException($message . ': expected substring is missing.');
        }
    }
}

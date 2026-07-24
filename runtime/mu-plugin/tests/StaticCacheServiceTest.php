<?php

require_once dirname(__DIR__) . '/src/Service/StaticCacheService.php';

use PlatformCore\Service\StaticCacheService;

final class StaticCacheServiceTest
{
    public static function run()
    {
        self::assertStorabilityMirrorsBypassRules();
        self::assertPathTraversalRefused();
        self::assertWriteAndInvalidateRoundTrip();
        self::assertInvalidateAllClearsEverything();
    }

    /**
     * The storable check must refuse exactly what the Caddy matcher bypasses.
     * If these drift, the cache writes files Caddy will never serve, or Caddy
     * serves stale files this class should have skipped.
     */
    private static function assertStorabilityMirrorsBypassRules()
    {
        $ok = ['method' => 'GET', 'status' => 200, 'cookies' => [], 'has_notice' => false, 'sets_cookie' => false];
        self::assertTrue(StaticCacheService::isStorable($ok), 'a plain anonymous GET is storable');

        self::assertFalse(StaticCacheService::isStorable(['method' => 'POST'] + $ok), 'POST is never storable');
        self::assertFalse(StaticCacheService::isStorable(['status' => 302] + $ok), 'non-200 is not storable');
        self::assertFalse(
            StaticCacheService::isStorable(['cookies' => ['woocommerce_items_in_cart' => '1']] + $ok),
            'a cart cookie forces bypass'
        );
        self::assertFalse(
            StaticCacheService::isStorable(['cookies' => ['wordpress_logged_in_abc' => 'x']] + $ok),
            'a logged-in cookie forces bypass'
        );
        self::assertFalse(StaticCacheService::isStorable(['has_notice' => true] + $ok), 'a rendered notice forces bypass');
        self::assertFalse(StaticCacheService::isStorable(['sets_cookie' => true] + $ok), 'a Set-Cookie response is not shareable');
    }

    private static function assertPathTraversalRefused()
    {
        $service = new StaticCacheService('/tmp/ooio-cache-test');
        self::assertTrue($service->fileFor('/../../etc/passwd') === null, 'traversal path is refused');
        self::assertTrue($service->fileFor("/shop\0/x") === null, 'null byte path is refused');
        self::assertTrue(is_string($service->fileFor('/shop/')), 'a normal path resolves to a file');
    }

    private static function assertWriteAndInvalidateRoundTrip()
    {
        $root = sys_get_temp_dir() . '/ooio-cache-' . getmypid();
        $service = new StaticCacheService($root);
        $ctx = ['method' => 'GET', 'status' => 200, 'cookies' => [], 'has_notice' => false, 'sets_cookie' => false];

        $file = $service->write('/shop/', '<html>shop</html>', $ctx);
        self::assertTrue(is_string($file) && is_file($file), 'a storable page is written to disk');
        self::assertTrue(file_get_contents($file) === '<html>shop</html>', 'the written body is the response body');

        // A page with a cart cookie must NOT be written.
        $skipped = $service->write('/shop/', 'x', ['cookies' => ['woocommerce_cart_hash' => '1']] + $ctx);
        self::assertTrue($skipped === null, 'a bypass request is never written');

        $service->invalidatePath('/shop/');
        self::assertFalse(is_file($file), 'invalidatePath removes the entry');
    }

    private static function assertInvalidateAllClearsEverything()
    {
        $root = sys_get_temp_dir() . '/ooio-cache-all-' . getmypid();
        $service = new StaticCacheService($root);
        $ctx = ['method' => 'GET', 'status' => 200, 'cookies' => [], 'has_notice' => false, 'sets_cookie' => false];
        $service->write('/', 'home', $ctx);
        $service->write('/shop/', 'shop', $ctx);
        $service->write('/product/x/', 'product', $ctx);

        $removed = $service->invalidateAll();
        self::assertTrue($removed === 3, 'invalidateAll removes every entry (got ' . $removed . ')');
        self::assertTrue($service->fileFor('/shop/') !== null && !is_file($service->fileFor('/shop/')), 'nothing remains after invalidateAll');
    }

    private static function assertTrue($cond, $message)
    {
        if ($cond !== true) {
            throw new RuntimeException('expected true: ' . $message);
        }
    }

    private static function assertFalse($cond, $message)
    {
        if ($cond !== false) {
            throw new RuntimeException('expected false: ' . $message);
        }
    }
}

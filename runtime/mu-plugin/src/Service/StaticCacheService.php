<?php

namespace PlatformCore\Service;

/**
 * Platform-managed static page cache.
 *
 * The mechanism (Caddy serving a pre-rendered file, bypassing on cookies) was
 * proven and measured in Spike #013: cache HIT 1606 req/s vs 47.8 req/s through
 * PHP. What that proof lacked, and what this class supplies, is the two halves a
 * cache cannot ship without:
 *
 *   WRITE       — render an anonymous, cacheable page once and store it.
 *   INVALIDATE  — delete stored pages when their data changes.
 *
 * Without invalidation a cache serves stale content, which is worse than no
 * cache. That is why Spike #013 refused to call SA48 done on the Caddy config
 * alone.
 *
 * This class is pure policy + filesystem. WordPress hooks live in the MU plugin
 * bootstrap and call these methods, so the decisions stay unit-testable.
 */
final class StaticCacheService
{
    /** @var string absolute path to the cache root Caddy also serves from */
    private $root;

    public function __construct($root)
    {
        $this->root = rtrim((string) $root, '/');
    }

    /**
     * May this response be stored as a shared, anonymous cache entry?
     *
     * Mirrors the Caddy matcher exactly — if the two disagree, Caddy would serve
     * a file this class should never have written, or skip one it wrote. Same
     * rule, stated once per side.
     */
    public static function isStorable(array $context)
    {
        if (($context['method'] ?? 'GET') !== 'GET') {
            return false;
        }
        if (($context['status'] ?? 200) !== 200) {
            return false;
        }
        // A cart/session/logged-in cookie makes the response visitor-specific;
        // WooCommerce itself sends nocache_headers() for cart holders (Spike #012).
        foreach ((array) ($context['cookies'] ?? []) as $name => $_value) {
            if (self::isBypassCookie((string) $name)) {
                return false;
            }
        }
        // A response that still carries a notice or Set-Cookie is not shareable.
        if (!empty($context['has_notice']) || !empty($context['sets_cookie'])) {
            return false;
        }
        return true;
    }

    public static function isBypassCookie($name)
    {
        foreach (['woocommerce_items_in_cart', 'woocommerce_cart_hash', 'wp_woocommerce_session_', 'wordpress_logged_in_'] as $prefix) {
            if (strpos((string) $name, $prefix) === 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Map a request path to a cache file. Refuses anything that could escape the
     * cache root: a path traversal here would let a request write or read
     * outside the managed directory.
     */
    public function fileFor($path)
    {
        $path = '/' . ltrim((string) $path, '/');
        if (strpos($path, '..') !== false || strpos($path, "\0") !== false) {
            return null;
        }
        $path = rtrim($path, '/');
        if ($path === '') {
            $path = '/';
        }
        return $this->root . $path . '/index.html';
    }

    /** Write a rendered page if the context says it is storable. Returns the file or null. */
    public function write($path, $html, array $context)
    {
        if (!self::isStorable($context)) {
            return null;
        }
        $file = $this->fileFor($path);
        if ($file === null) {
            return null;
        }
        $dir = dirname($file);
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            return null;
        }
        // Write-then-rename so a concurrent reader never sees a half-written file.
        $tmp = $file . '.' . getmypid() . '.tmp';
        if (@file_put_contents($tmp, (string) $html) === false) {
            return null;
        }
        if (!@rename($tmp, $file)) {
            @unlink($tmp);
            return null;
        }
        return $file;
    }

    /**
     * Remove one path's cache entry. Used when a specific URL's data changes.
     */
    public function invalidatePath($path)
    {
        $file = $this->fileFor($path);
        if ($file !== null && is_file($file)) {
            @unlink($file);
        }
    }

    /**
     * Remove every cache entry. The safe default when a change's blast radius is
     * uncertain: a product edit can affect the shop grid, its category pages, the
     * home page, and search results. Deleting everything is cheap (files rebuild
     * on next miss) and correct; trying to compute the exact affected set is the
     * kind of cleverness that ships stale pages.
     */
    public function invalidateAll()
    {
        if (!is_dir($this->root)) {
            return 0;
        }
        $count = 0;
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($this->root, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST
        );
        foreach ($iterator as $item) {
            if ($item->isFile() && $item->getFilename() === 'index.html') {
                @unlink($item->getPathname());
                $count++;
            }
        }
        return $count;
    }
}

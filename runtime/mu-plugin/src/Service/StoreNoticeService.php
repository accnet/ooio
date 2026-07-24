<?php

namespace PlatformCore\Service;

/**
 * Pure policy and presentation helpers for deferred storefront notices.
 */
final class StoreNoticeService
{
    public static function shouldDefer(array $context)
    {
        return empty($context['is_admin'])
            && empty($context['doing_ajax'])
            && empty($context['is_rest'])
            && empty($context['is_cart'])
            && empty($context['is_checkout']);
    }

    public static function cacheHeaders()
    {
        return array(
            'Cache-Control' => 'private, no-store, no-cache, must-revalidate, max-age=0',
            'Pragma' => 'no-cache',
            'Expires' => '0',
            'Vary' => 'Cookie',
        );
    }

    public static function clientScript($endpoint)
    {
        $encodedEndpoint = json_encode((string) $endpoint, JSON_UNESCAPED_SLASHES);

        return "(function () {\n"
            . "    var endpoint = {$encodedEndpoint};\n"
            . "    var containerId = 'platform-core-store-notices';\n"
            . "    if (!window.fetch) { return; }\n"
            . "    window.fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })\n"
            . "        .then(function (response) { return response.ok ? response.json() : null; })\n"
            . "        .then(function (payload) {\n"
            . "            if (!payload || !payload.html) { return; }\n"
            . "            var container = document.getElementById(containerId);\n"
            . "            if (!container) {\n"
            . "                container = document.createElement('div');\n"
            . "                container.id = containerId;\n"
            . "            }\n"
            . "            container.innerHTML = payload.html;\n"
            . "            var target = document.querySelector('.woocommerce') || document.querySelector('main') || document.body;\n"
            . "            if (target && container.parentNode !== target) { target.insertBefore(container, target.firstChild); }\n"
            . "        });\n"
            . "}());";
    }
}

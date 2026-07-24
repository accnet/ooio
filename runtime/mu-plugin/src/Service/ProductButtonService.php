<?php

namespace PlatformCore\Service;

/**
 * Make the Add-to-Cart button render identically for every visitor.
 *
 * WooCommerce's `product-button` block writes the CURRENT VISITOR'S cart state
 * into server-rendered HTML — `"tempQuantity":1` in the interactivity context and
 * "1 in cart" as the button label. Unlike a store notice, this is not a one-shot
 * flash: it is present in every product tile, on every page load, for as long as
 * the cart holds that item. Measured on `/shop/` 2026-07-23, it was the blocker
 * that remained after the notice was deferred.
 *
 * Neutralising it is safe because the block already carries
 * `data-wp-run="callbacks.syncTempQuantityOnLoad"` and
 * `data-wp-text="state.addToCartText"`: the Interactivity API re-derives both
 * values on the client from the Store API cart. The server rendering them is a
 * progressive-enhancement nicety, and it costs the whole page its cacheability.
 *
 * What this deliberately does NOT do: touch prices, stock, or availability. Those
 * are the same for every visitor and must keep rendering server-side.
 */
final class ProductButtonService
{
    /**
     * Rewrite one rendered `woocommerce/product-button` block so it carries no
     * visitor-specific state. Idempotent: a block already at zero is unchanged.
     */
    public static function neutralise($html)
    {
        $html = (string) $html;
        if ($html === '' || strpos($html, 'tempQuantity') === false) {
            return $html;
        }

        $label = self::addToCartText($html);

        // Reset the quantity the server observed in this visitor's cart.
        $html = preg_replace('/("tempQuantity"\s*:\s*)\d+/', '${1}0', $html);

        // The label span is bound to `state.addToCartText`; the client will
        // overwrite it. Rendering the neutral text keeps no-JS visitors sensible
        // and makes the byte stream identical between visitors.
        if ($label !== null) {
            $html = preg_replace(
                '/(<span\s[^>]*data-wp-text="state\.addToCartText"[^>]*>)(.*?)(<\/span>)/s',
                '${1}' . str_replace('$', '\\$', $label) . '${3}',
                $html,
                1
            );
        }

        return $html;
    }

    /**
     * Read `addToCartText` out of the block's own interactivity context rather
     * than hard-coding "Add to cart": the string is translated, and a wrong
     * guess would silently change the storefront in every locale but English.
     */
    private static function addToCartText($html)
    {
        if (!preg_match("/data-wp-context='([^']*)'/", $html, $matches)) {
            return null;
        }

        $context = json_decode(html_entity_decode($matches[1], ENT_QUOTES, 'UTF-8'), true);
        if (!is_array($context) || !isset($context['addToCartText'])) {
            return null;
        }

        return (string) $context['addToCartText'];
    }
}

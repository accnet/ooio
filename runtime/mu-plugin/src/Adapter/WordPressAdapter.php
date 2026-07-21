<?php

namespace PlatformCore\Adapter;

/**
 * Seam between application services and WordPress Core APIs.
 *
 * The interface deliberately contains WordPress operations only. It must not
 * acquire SaaS billing, subscription, or direct-database responsibilities.
 */
interface WordPressAdapter
{
    public function health();

    public function createSite(array $input);

    public function deleteSite($siteId);

    public function suspendSite($siteId);

    public function activatePlugin(array $input);

    public function switchTheme(array $input);

    public function createUser(array $input);

    public function updateOption(array $input);
}


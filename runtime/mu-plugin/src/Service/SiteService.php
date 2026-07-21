<?php

namespace PlatformCore\Service;

use PlatformCore\Adapter\WordPressAdapter;

/**
 * Application service for the small WordPress operation surface exposed by
 * the draft Agent-to-MU Plugin contract.
 */
final class SiteService
{
    /** @var WordPressAdapter */
    private $adapter;

    public function __construct(WordPressAdapter $adapter)
    {
        $this->adapter = $adapter;
    }

    public function health()
    {
        return $this->adapter->health();
    }

    public function createSite(array $input)
    {
        $site = SiteInput::fromArray($input);

        return $this->adapter->createSite($site->toArray());
    }

    public function deleteSite($siteId)
    {
        if (!is_scalar($siteId) || !preg_match('/^[1-9][0-9]*$/', (string) $siteId)) {
            throw new \InvalidArgumentException('siteId must be a positive integer.');
        }

        return $this->adapter->deleteSite($siteId);
    }

    public function suspendSite($siteId)
    {
        return $this->adapter->suspendSite($siteId);
    }

    public function activatePlugin(array $input)
    {
        return (new PluginService($this->adapter))->activatePlugin($input);
    }

    public function switchTheme(array $input)
    {
        return (new ThemeService($this->adapter))->switchTheme($input);
    }

    public function createUser(array $input)
    {
        return (new UserService($this->adapter))->createUser($input);
    }

    public function updateOption(array $input)
    {
        return (new OptionService($this->adapter))->updateOption($input);
    }
}

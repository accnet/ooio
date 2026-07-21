<?php

namespace PlatformCore\Service;

use PlatformCore\Adapter\WordPressAdapter;
use InvalidArgumentException;

/**
 * Application service for activating a plugin on a WordPress site.
 */
final class PluginService
{
    /** @var WordPressAdapter */
    private $adapter;

    public function __construct(WordPressAdapter $adapter)
    {
        $this->adapter = $adapter;
    }

    public function activatePlugin(array $input)
    {
        $siteId = self::positiveSiteId($input);
        $plugin = self::requiredString($input, 'plugin');
        if (strpos($plugin, "\0") !== false) {
            throw new InvalidArgumentException('plugin must not contain null bytes.');
        }

        $networkWide = false;
        if (array_key_exists('networkWide', $input)) {
            if (!is_bool($input['networkWide'])) {
                throw new InvalidArgumentException('networkWide must be a boolean.');
            }
            $networkWide = $input['networkWide'];
        }

        return $this->adapter->activatePlugin(array(
            'siteId' => $siteId,
            'plugin' => $plugin,
            'networkWide' => $networkWide,
        ));
    }

    private static function positiveSiteId(array $input)
    {
        if (!array_key_exists('siteId', $input) || !is_scalar($input['siteId']) || !preg_match('/^[1-9][0-9]*$/', (string) $input['siteId'])) {
            throw new InvalidArgumentException('siteId must be a positive integer.');
        }

        return (string) $input['siteId'];
    }

    private static function requiredString(array $input, $field)
    {
        if (!array_key_exists($field, $input) || !is_string($input[$field]) || trim($input[$field]) === '') {
            throw new InvalidArgumentException($field . ' is required.');
        }

        return trim($input[$field]);
    }
}

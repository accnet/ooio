<?php

namespace PlatformCore\Service;

use PlatformCore\Adapter\WordPressAdapter;
use InvalidArgumentException;

/**
 * Application service for switching a site's active theme.
 */
final class ThemeService
{
    /** @var WordPressAdapter */
    private $adapter;

    public function __construct(WordPressAdapter $adapter)
    {
        $this->adapter = $adapter;
    }

    public function switchTheme(array $input)
    {
        $siteId = self::positiveSiteId($input);
        $theme = self::requiredString($input, 'theme');
        if (strpos($theme, "\0") !== false) {
            throw new InvalidArgumentException('theme must not contain null bytes.');
        }

        return $this->adapter->switchTheme(array(
            'siteId' => $siteId,
            'theme' => $theme,
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

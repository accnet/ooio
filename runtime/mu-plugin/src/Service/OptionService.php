<?php

namespace PlatformCore\Service;

use PlatformCore\Adapter\WordPressAdapter;
use InvalidArgumentException;

/**
 * Application service for updating a WordPress option on a site.
 */
final class OptionService
{
    /** @var WordPressAdapter */
    private $adapter;

    public function __construct(WordPressAdapter $adapter)
    {
        $this->adapter = $adapter;
    }

    public function updateOption(array $input)
    {
        $siteId = self::positiveSiteId($input);
        $name = self::requiredString($input, 'name');
        if (strpos($name, "\0") !== false) {
            throw new InvalidArgumentException('name must not contain null bytes.');
        }
        if (!array_key_exists('value', $input)) {
            throw new InvalidArgumentException('value is required.');
        }

        return $this->adapter->updateOption(array(
            'siteId' => $siteId,
            'name' => $name,
            'value' => $input['value'],
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

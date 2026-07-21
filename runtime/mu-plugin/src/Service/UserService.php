<?php

namespace PlatformCore\Service;

use PlatformCore\Adapter\WordPressAdapter;
use InvalidArgumentException;

/**
 * Application service for creating a WordPress user on a site.
 */
final class UserService
{
    /** @var WordPressAdapter */
    private $adapter;

    public function __construct(WordPressAdapter $adapter)
    {
        $this->adapter = $adapter;
    }

    public function createUser(array $input)
    {
        $siteId = self::positiveSiteId($input);
        $username = self::requiredString($input, 'username');
        $email = self::requiredString($input, 'email');
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new InvalidArgumentException('email must be a valid email address.');
        }
        $role = self::requiredString($input, 'role');
        if (strpos($username, "\0") !== false || strpos($role, "\0") !== false) {
            throw new InvalidArgumentException('user fields must not contain null bytes.');
        }

        $validated = array(
            'siteId' => $siteId,
            'username' => $username,
            'email' => $email,
            'role' => $role,
        );
        if (array_key_exists('password', $input)) {
            if (!is_string($input['password'])) {
                throw new InvalidArgumentException('password must be a string.');
            }
            $validated['password'] = $input['password'];
        }

        return $this->adapter->createUser($validated);
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

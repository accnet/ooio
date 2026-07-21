<?php

namespace PlatformCore\Service;

use InvalidArgumentException;

/**
 * Validated input for the WordPress site lifecycle operations.
 */
final class SiteInput
{
    /** @var string */
    private $domain;

    /** @var string */
    private $path;

    /** @var string */
    private $title;

    /** @var string */
    private $adminEmail;

    private function __construct($domain, $path, $title, $adminEmail)
    {
        $this->domain = $domain;
        $this->path = $path;
        $this->title = $title;
        $this->adminEmail = $adminEmail;
    }

    /**
     * @param array $input
     * @return self
     * @throws InvalidArgumentException
     */
    public static function fromArray(array $input)
    {
        $domain = null;
        if (array_key_exists('domain', $input)) {
            if (!is_string($input['domain']) || trim($input['domain']) === '') {
                throw new InvalidArgumentException('domain must be a valid hostname.');
            }

            $domain = self::normalizeDomain($input['domain']);
        }

        $path = array_key_exists('path', $input) ? $input['path'] : '/';
        if (!is_string($path)) {
            throw new InvalidArgumentException('path must be a string.');
        }
        $path = trim($path);
        if ($path === '') {
            $path = '/';
        }
        if (strlen($path) > 255 || $path[0] !== '/' || strpos($path, '?') !== false || strpos($path, '#') !== false || strpos($path, '\\') !== false) {
            throw new InvalidArgumentException('path must be a valid WordPress path.');
        }
        foreach (explode('/', $path) as $segment) {
            if ($segment === '..') {
                throw new InvalidArgumentException('path must not contain parent-directory segments.');
            }
        }
        if ($path !== '/' && substr($path, -1) !== '/') {
            $path .= '/';
        }

        $title = self::requiredString($input, 'title');
        if (strlen($title) > 255) {
            throw new InvalidArgumentException('title must be 255 characters or fewer.');
        }

        $adminEmail = array_key_exists('adminEmail', $input) ? $input['adminEmail'] : (isset($input['admin_email']) ? $input['admin_email'] : null);
        if (!is_string($adminEmail) || trim($adminEmail) === '' || filter_var(trim($adminEmail), FILTER_VALIDATE_EMAIL) === false) {
            throw new InvalidArgumentException('adminEmail must be a valid email address.');
        }

        return new self($domain, $path, $title, trim($adminEmail));
    }

    public function toArray()
    {
        return array(
            'domain' => $this->domain,
            'path' => $this->path,
            'title' => $this->title,
            'adminEmail' => $this->adminEmail,
        );
    }

    private static function requiredString(array $input, $field)
    {
        if (!array_key_exists($field, $input) || !is_string($input[$field]) || trim($input[$field]) === '') {
            throw new InvalidArgumentException($field . ' is required.');
        }

        return trim($input[$field]);
    }

    private static function normalizeDomain($value)
    {
        $domain = strtolower(trim($value));
        $host = $domain;

        if (substr_count($domain, ':') === 1 && preg_match('/^(.+):([0-9]+)$/', $domain, $matches)) {
            $host = $matches[1];
            $port = (int) $matches[2];
            if ($port < 1 || $port > 65535) {
                throw new InvalidArgumentException('domain port must be between 1 and 65535.');
            }
        } elseif (strpos($domain, ':') !== false) {
            throw new InvalidArgumentException('domain must be a valid hostname with an optional port.');
        }

        if (filter_var($host, FILTER_VALIDATE_DOMAIN, FILTER_FLAG_HOSTNAME) === false) {
            throw new InvalidArgumentException('domain must be a valid hostname.');
        }

        return $domain;
    }
}

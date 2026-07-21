<?php

namespace PlatformCore\Adapter;

/**
 * Thin WordPress Core adapter. Business policy belongs in application
 * services; this class only maps requests to supported Core APIs.
 */
final class CoreWordPressAdapter implements WordPressAdapter
{
    public function health()
    {
        return array(
            'status' => 'ok',
            'plugin' => 'platform-core',
            'wordpress' => function_exists('get_bloginfo') ? (string) \get_bloginfo('version') : 'unknown',
        );
    }

    public function createSite(array $input)
    {
        if (!function_exists('wpmu_create_blog')) {
            return $this->wordpressError('platform_core_unavailable', 'WordPress multisite API is unavailable.');
        }

        $clientDomain = isset($input['domain']) ? (string) $input['domain'] : '';
        $domain = $this->resolveSiteDomain($clientDomain);
        if ($domain === null) {
            return $this->wordpressError('platform_core_domain_unavailable', 'A network domain is required for site creation.');
        }
        $path = isset($input['path']) && $input['path'] !== '' ? (string) $input['path'] : '/';
        $title = (string) $input['title'];
        $user_id = function_exists('get_current_user_id') ? (int) \get_current_user_id() : 0;
        $network_id = function_exists('get_current_network_id') ? (int) \get_current_network_id() : null;
        $site_id = \wpmu_create_blog($domain, $path, $title, $user_id, array(), $network_id);

        if (function_exists('is_wp_error') && \is_wp_error($site_id)) {
            return $site_id;
        }

        $this->finalizeSite($site_id);

        return array(
            'siteId' => (string) $site_id,
            'domain' => $domain,
            'status' => 'active',
        );
    }

    private function resolveSiteDomain($clientDomain)
    {
        if (function_exists('is_subdomain_install') && \is_subdomain_install()) {
            return $clientDomain !== '' ? $clientDomain : null;
        }

        if (function_exists('get_current_site')) {
            $site = \get_current_site();
            $domain = $this->networkDomain($site);
            if ($domain !== null) {
                return $domain;
            }
        }

        if (function_exists('get_network')) {
            $network = \get_network();
            $domain = $this->networkDomain($network);
            if ($domain !== null) {
                return $domain;
            }
        }

        return null;
    }

    private function networkDomain($network)
    {
        if (is_object($network) && isset($network->domain) && is_string($network->domain) && $network->domain !== '') {
            return $network->domain;
        }
        if (is_array($network) && isset($network['domain']) && is_string($network['domain']) && $network['domain'] !== '') {
            return $network['domain'];
        }

        return null;
    }

    private function finalizeSite($siteId)
    {
        if (!function_exists('switch_to_blog')) {
            return;
        }

        \switch_to_blog((int) $siteId);
        try {
            if (function_exists('flush_rewrite_rules')) {
                \flush_rewrite_rules(true);
            }
            if (function_exists('update_option')) {
                \update_option('blog_public', 1);
            }
        } finally {
            if (function_exists('restore_current_blog')) {
                \restore_current_blog();
            }
        }
    }

    public function deleteSite($siteId)
    {
        if (!function_exists('wp_delete_site')) {
            return $this->wordpressError('platform_core_unavailable', 'WordPress multisite API is unavailable.');
        }

        $result = \wp_delete_site((int) $siteId);
        if (function_exists('is_wp_error') && \is_wp_error($result)) {
            return $result;
        }
        if ($result === false) {
            return $this->wordpressError('platform_core_delete_failed', 'WordPress could not delete the site.');
        }

        return array('siteId' => (string) $siteId, 'status' => 'deletion_accepted');
    }

    public function suspendSite($siteId)
    {
        if (!function_exists('update_blog_status')) {
            return $this->wordpressError('platform_core_unavailable', 'WordPress multisite API is unavailable.');
        }

        $result = \update_blog_status((int) $siteId, 'public', 0);
        if ($this->isWordPressError($result)) {
            return $result;
        }

        return array('siteId' => (string) $siteId, 'status' => 'suspended');
    }

    public function activatePlugin(array $input)
    {
        if (!function_exists('activate_plugin')) {
            if (defined('ABSPATH')) {
                $plugin_api = ABSPATH . 'wp-admin/includes/plugin.php';
                if (is_readable($plugin_api)) {
                    require_once $plugin_api;
                }
            }
        }
        if (!function_exists('activate_plugin')) {
            return $this->wordpressError('platform_core_unavailable', 'WordPress plugin API is unavailable.');
        }

        $switched = $this->switchToSite($input['siteId']);
        if ($this->isWordPressError($switched)) {
            return $switched;
        }

        $networkWide = isset($input['networkWide']) ? (bool) $input['networkWide'] : false;
        try {
            $result = \activate_plugin((string) $input['plugin'], '', $networkWide, false);
        } finally {
            $this->restoreSite($switched);
        }

        if ($this->isWordPressError($result)) {
            return $result;
        }

        return array('siteId' => (string) $input['siteId'], 'plugin' => (string) $input['plugin'], 'networkWide' => $networkWide, 'status' => 'active');
    }

    public function switchTheme(array $input)
    {
        if (!function_exists('switch_theme')) {
            return $this->wordpressError('platform_core_unavailable', 'WordPress theme API is unavailable.');
        }

        $switched = $this->switchToSite($input['siteId']);
        if ($this->isWordPressError($switched)) {
            return $switched;
        }

        try {
            \switch_theme((string) $input['theme']);
        } finally {
            $this->restoreSite($switched);
        }

        return array('siteId' => (string) $input['siteId'], 'theme' => (string) $input['theme'], 'status' => 'active');
    }

    public function createUser(array $input)
    {
        if (!function_exists('wp_insert_user')) {
            return $this->wordpressError('platform_core_unavailable', 'WordPress user API is unavailable.');
        }

        $switched = $this->switchToSite($input['siteId']);
        if ($this->isWordPressError($switched)) {
            return $switched;
        }

        $user = array(
            'user_login' => (string) $input['username'],
            'user_email' => (string) $input['email'],
            'role' => (string) $input['role'],
        );
        if (isset($input['password']) && $input['password'] !== '') {
            $user['user_pass'] = (string) $input['password'];
        }

        try {
            $user_id = \wp_insert_user($user);
        } finally {
            $this->restoreSite($switched);
        }

        if ($this->isWordPressError($user_id)) {
            return $user_id;
        }

        return array('userId' => (string) $user_id, 'username' => (string) $input['username'], 'role' => (string) $input['role']);
    }

    public function updateOption(array $input)
    {
        if (!function_exists('update_option')) {
            return $this->wordpressError('platform_core_unavailable', 'WordPress options API is unavailable.');
        }

        $switched = $this->switchToSite($input['siteId']);
        if ($this->isWordPressError($switched)) {
            return $switched;
        }

        try {
            $updated = \update_option((string) $input['name'], $input['value']);
        } finally {
            $this->restoreSite($switched);
        }

        return array(
            'siteId' => (string) $input['siteId'],
            'name' => (string) $input['name'],
            'updated' => (bool) $updated,
        );
    }

    private function switchToSite($siteId)
    {
        if (!function_exists('switch_to_blog') || !function_exists('get_current_blog_id')) {
            return $this->wordpressError('platform_core_unavailable', 'WordPress site API is unavailable.');
        }

        $previous = (int) \get_current_blog_id();
        \switch_to_blog((int) $siteId);
        return $previous;
    }

    private function restoreSite($previousSiteId)
    {
        if (function_exists('switch_to_blog')) {
            \switch_to_blog((int) $previousSiteId);
        }
    }

    private function wordpressError($code, $message)
    {
        if (class_exists('WP_Error')) {
            return new \WP_Error($code, $message);
        }

        return array('error' => $code, 'message' => $message);
    }

    private function isWordPressError($value)
    {
        return function_exists('is_wp_error') && \is_wp_error($value);
    }
}

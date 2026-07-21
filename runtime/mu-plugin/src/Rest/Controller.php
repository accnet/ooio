<?php

namespace PlatformCore\Rest;

use PlatformCore\Service\SiteService;

/**
 * REST transport adapter. WordPress itself owns the HTTP listener; deployment
 * must configure the REST virtual host to bind to 127.0.0.1 only.
 */
final class Controller
{
    /** @var SiteService */
    private $service;

    public function __construct(SiteService $service)
    {
        $this->service = $service;
    }

    public function register_routes()
    {
        \register_rest_route('platform/v1', '/health', array(
            'methods' => \WP_REST_Server::READABLE,
            'callback' => array($this, 'health'),
            'permission_callback' => array($this, 'authorizeLocalRequest'),
        ));

        \register_rest_route('platform/v1', '/sites', array(
            array(
                'methods' => \WP_REST_Server::CREATABLE,
                'callback' => array($this, 'createSite'),
                'permission_callback' => array($this, 'authorizeRequest'),
            ),
        ));

        \register_rest_route('platform/v1', '/sites/(?P<siteId>[1-9][0-9]*)', array(
            array(
                'methods' => \WP_REST_Server::DELETABLE,
                'callback' => array($this, 'deleteSite'),
                'permission_callback' => array($this, 'authorizeRequest'),
            ),
        ));

        \register_rest_route('platform/v1', '/sites/(?P<siteId>[^/]+)/suspend', array(
            'methods' => \WP_REST_Server::CREATABLE,
            'callback' => array($this, 'suspendSite'),
            'permission_callback' => array($this, 'authorizeRequest'),
        ));

        \register_rest_route('platform/v1', '/plugins/activate', array(
            'methods' => \WP_REST_Server::CREATABLE,
            'callback' => array($this, 'activatePlugin'),
            'permission_callback' => array($this, 'authorizeRequest'),
        ));

        \register_rest_route('platform/v1', '/themes/switch', array(
            'methods' => \WP_REST_Server::CREATABLE,
            'callback' => array($this, 'switchTheme'),
            'permission_callback' => array($this, 'authorizeRequest'),
        ));

        \register_rest_route('platform/v1', '/users', array(
            'methods' => \WP_REST_Server::CREATABLE,
            'callback' => array($this, 'createUser'),
            'permission_callback' => array($this, 'authorizeRequest'),
        ));

        \register_rest_route('platform/v1', '/options', array(
            'methods' => \WP_REST_Server::CREATABLE,
            'callback' => array($this, 'updateOption'),
            'permission_callback' => array($this, 'authorizeRequest'),
        ));
    }

    public function health($request)
    {
        return $this->respond($this->service->health());
    }

    public function createSite($request)
    {
        $input = $this->jsonBody($request, array('domain', 'title'));
        if ($this->isError($input)) {
            return $input;
        }

        try {
            return $this->respond($this->service->createSite($input), 201);
        } catch (\InvalidArgumentException $exception) {
            return $this->badRequest($exception->getMessage());
        }
    }

    public function deleteSite($request)
    {
        $site_id = $request->get_param('siteId');
        if (!is_scalar($site_id) || (string) $site_id === '') {
            return $this->badRequest('siteId is required.');
        }

        try {
            return $this->respond($this->service->deleteSite((string) $site_id), 202);
        } catch (\InvalidArgumentException $exception) {
            return $this->badRequest($exception->getMessage());
        }
    }

    public function suspendSite($request)
    {
        return $this->respond($this->service->suspendSite((string) $request->get_param('siteId')), 202);
    }

    public function activatePlugin($request)
    {
        $input = $this->jsonBody($request, array('siteId', 'plugin'));
        if ($this->isError($input)) {
            return $input;
        }

        try {
            return $this->respond($this->service->activatePlugin($input));
        } catch (\InvalidArgumentException $exception) {
            return $this->badRequest($exception->getMessage());
        }
    }

    public function switchTheme($request)
    {
        $input = $this->jsonBody($request, array('siteId', 'theme'));
        if ($this->isError($input)) {
            return $input;
        }

        try {
            return $this->respond($this->service->switchTheme($input));
        } catch (\InvalidArgumentException $exception) {
            return $this->badRequest($exception->getMessage());
        }
    }

    public function createUser($request)
    {
        $input = $this->jsonBody($request, array('siteId', 'username', 'email', 'role'));
        if ($this->isError($input)) {
            return $input;
        }

        try {
            return $this->respond($this->service->createUser($input), 201);
        } catch (\InvalidArgumentException $exception) {
            return $this->badRequest($exception->getMessage());
        }
    }

    public function updateOption($request)
    {
        $input = $this->jsonBody($request, array('siteId', 'name', 'value'));
        if ($this->isError($input)) {
            return $input;
        }

        try {
            return $this->respond($this->service->updateOption($input));
        } catch (\InvalidArgumentException $exception) {
            return $this->badRequest($exception->getMessage());
        }
    }

    public function authorizeLocalRequest($request)
    {
        if (!$this->isLocalhost()) {
            return new \WP_Error('platform_core_localhost_only', 'Platform Core accepts localhost requests only.', array('status' => 403));
        }

        return true;
    }

    public function authorizeRequest($request)
    {
        $local = $this->authorizeLocalRequest($request);
        if ($local !== true) {
            return $local;
        }

        $secret = defined('PLATFORM_CORE_SHARED_SECRET') ? (string) PLATFORM_CORE_SHARED_SECRET : '';
        if ($secret === '') {
            return new \WP_Error('platform_core_auth_not_configured', 'Local shared-secret authentication is not configured.', array('status' => 503));
        }

        $authorization = trim((string) $request->get_header('authorization'));
        if (!preg_match('/^Bearer\\s+(.+)$/i', $authorization, $matches) || !hash_equals($secret, $matches[1])) {
            return new \WP_Error('platform_core_unauthorized', 'A valid bearer credential is required.', array('status' => 401));
        }

        return true;
    }

    private function isLocalhost()
    {
        $remote_address = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
        return in_array($remote_address, array('127.0.0.1', '::1'), true);
    }

    private function jsonBody($request, array $required)
    {
        $body = $request->get_json_params();
        if (!is_array($body)) {
            return $this->badRequest('A JSON request body is required.');
        }

        foreach ($required as $field) {
            if (!array_key_exists($field, $body) || (is_string($body[$field]) && trim($body[$field]) === '')) {
                return $this->badRequest($field . ' is required.');
            }
        }

        return $body;
    }

    private function respond($result, $status = 200)
    {
        if ($this->isError($result)) {
            return $result;
        }

        return new \WP_REST_Response($result, $status);
    }

    private function badRequest($message)
    {
        return new \WP_Error('platform_core_bad_request', $message, array('status' => 400));
    }

    private function isError($value)
    {
        return function_exists('is_wp_error') && \is_wp_error($value);
    }
}

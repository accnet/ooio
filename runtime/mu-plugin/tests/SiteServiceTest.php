<?php

require_once __DIR__ . '/../src/Adapter/WordPressAdapter.php';
require_once __DIR__ . '/../src/Adapter/CoreWordPressAdapter.php';
require_once __DIR__ . '/../src/Service/SiteInput.php';
require_once __DIR__ . '/../src/Service/SiteService.php';

function wpmu_create_blog($domain, $path, $title, $userId, $meta, $networkId)
{
    $GLOBALS['site_test_calls'][] = 'create:' . $domain;
    return 43;
}

function is_subdomain_install()
{
    return !empty($GLOBALS['site_test_subdomain']);
}

function get_current_site()
{
    return (object) array('domain' => 'network.example.test');
}

function get_current_user_id()
{
    return 7;
}

function get_current_network_id()
{
    return 1;
}

function switch_to_blog($siteId)
{
    $GLOBALS['site_test_calls'][] = 'switch:' . $siteId;
}

function flush_rewrite_rules($hard)
{
    $GLOBALS['site_test_calls'][] = 'flush:' . ($hard ? 'true' : 'false');
}

function update_option($name, $value)
{
    $GLOBALS['site_test_calls'][] = 'option:' . $name . ':' . $value;
}

function restore_current_blog()
{
    $GLOBALS['site_test_calls'][] = 'restore';
}

use PlatformCore\Adapter\WordPressAdapter;
use PlatformCore\Adapter\CoreWordPressAdapter;
use PlatformCore\Service\SiteService;

final class FakeWordPressAdapter implements WordPressAdapter
{
    public $created = array();
    public $deleted = array();

    public function health() { return array('status' => 'ok'); }
    public function createSite(array $input) { $this->created[] = $input; return array('siteId' => '42'); }
    public function deleteSite($siteId) { $this->deleted[] = (string) $siteId; return array('siteId' => (string) $siteId); }
    public function suspendSite($siteId) { return array('siteId' => (string) $siteId); }
    public function activatePlugin(array $input) { return $input; }
    public function switchTheme(array $input) { return $input; }
    public function createUser(array $input) { return $input; }
    public function updateOption(array $input) { return $input; }
}

final class SiteServiceTest
{
    public static function run()
    {
        self::createsSiteWithNormalizedValidatedInput();
        self::allowsOptionalDomainAndHostPort();
        self::usesNetworkDomainAndFinalizesSubdirectorySite();
        self::usesClientDomainForSubdomainSite();
        self::deletesSiteThroughTheAdapter();
        self::rejectsInvalidSiteInput();
        self::rejectsInvalidSiteId();
    }

    private static function createsSiteWithNormalizedValidatedInput()
    {
        $adapter = new FakeWordPressAdapter();
        $service = new SiteService($adapter);
        $result = $service->createSite(array(
            'domain' => 'Store.Example.test',
            'path' => '/store',
            'title' => 'Example Store',
            'adminEmail' => ' admin@example.test ',
        ));

        self::same(array('siteId' => '42'), $result, 'create result');
        self::same(array(array(
            'domain' => 'store.example.test',
            'path' => '/store/',
            'title' => 'Example Store',
            'adminEmail' => 'admin@example.test',
        )), $adapter->created, 'validated create input');
    }

    private static function deletesSiteThroughTheAdapter()
    {
        $adapter = new FakeWordPressAdapter();
        $service = new SiteService($adapter);
        $service->deleteSite('42');

        self::same(array('42'), $adapter->deleted, 'delete site id');
    }

    private static function allowsOptionalDomainAndHostPort()
    {
        $adapter = new FakeWordPressAdapter();
        $service = new SiteService($adapter);
        $service->createSite(array(
            'title' => 'Network Store',
            'adminEmail' => 'admin@example.test',
        ));
        self::same(null, $adapter->created[0]['domain'], 'optional domain');

        $service->createSite(array(
            'domain' => 'Store.Example.test:8443',
            'title' => 'Port Store',
            'adminEmail' => 'admin@example.test',
        ));
        self::same('store.example.test:8443', $adapter->created[1]['domain'], 'host and port domain');
    }

    private static function usesNetworkDomainAndFinalizesSubdirectorySite()
    {
        $GLOBALS['site_test_calls'] = array();
        $GLOBALS['site_test_subdomain'] = false;
        $result = (new CoreWordPressAdapter())->createSite(array(
            'domain' => 'client.example.test',
            'path' => '/store/',
            'title' => 'Store',
        ));

        self::same('network.example.test', $result['domain'], 'subdirectory domain');
        self::same(array(
            'create:network.example.test',
            'switch:43',
            'flush:true',
            'option:blog_public:1',
            'restore',
        ), $GLOBALS['site_test_calls'], 'subdirectory finalization');
    }

    private static function usesClientDomainForSubdomainSite()
    {
        $GLOBALS['site_test_calls'] = array();
        $GLOBALS['site_test_subdomain'] = true;
        $result = (new CoreWordPressAdapter())->createSite(array(
            'domain' => 'client.example.test',
            'title' => 'Store',
        ));

        self::same('client.example.test', $result['domain'], 'subdomain domain');
        self::same('create:client.example.test', $GLOBALS['site_test_calls'][0], 'subdomain create domain');
    }

    private static function rejectsInvalidSiteInput()
    {
        $invalidInputs = array(
            array('domain' => 'not a host', 'title' => 'Store', 'adminEmail' => 'admin@example.test'),
            array('domain' => 'store.example.test', 'path' => 'store', 'title' => 'Store', 'adminEmail' => 'admin@example.test'),
            array('domain' => 'store.example.test', 'title' => '', 'adminEmail' => 'admin@example.test'),
            array('domain' => 'store.example.test', 'title' => 'Store', 'adminEmail' => 'not-an-email'),
        );

        foreach ($invalidInputs as $input) {
            $adapter = new FakeWordPressAdapter();
            $service = new SiteService($adapter);
            self::throwsInvalidArgument(function () use ($service, $input) {
                $service->createSite($input);
            }, 'invalid site input');
            self::same(array(), $adapter->created, 'adapter not called for invalid input');
        }
    }

    private static function rejectsInvalidSiteId()
    {
        $service = new SiteService(new FakeWordPressAdapter());
        self::throwsInvalidArgument(function () use ($service) {
            $service->deleteSite('0');
        }, 'invalid site id');
    }

    private static function throwsInvalidArgument(callable $callable, $message)
    {
        try {
            $callable();
        } catch (InvalidArgumentException $exception) {
            return;
        }

        throw new RuntimeException($message . ': expected InvalidArgumentException.');
    }

    private static function same($expected, $actual, $message)
    {
        if ($expected !== $actual) {
            throw new RuntimeException($message . ': values differ.');
        }
    }
}

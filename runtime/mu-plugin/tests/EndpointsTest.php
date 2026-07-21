<?php

require_once __DIR__ . '/../src/Adapter/WordPressAdapter.php';
require_once __DIR__ . '/../src/Service/PluginService.php';
require_once __DIR__ . '/../src/Service/ThemeService.php';
require_once __DIR__ . '/../src/Service/UserService.php';
require_once __DIR__ . '/../src/Service/OptionService.php';
require_once __DIR__ . '/../src/Service/SiteService.php';

use PlatformCore\Adapter\WordPressAdapter;
use PlatformCore\Service\OptionService;
use PlatformCore\Service\PluginService;
use PlatformCore\Service\SiteService;
use PlatformCore\Service\ThemeService;
use PlatformCore\Service\UserService;

final class EndpointFakeWordPressAdapter implements WordPressAdapter
{
    public $calls = array();

    public function health() { return array('status' => 'ok'); }
    public function createSite(array $input) { return $input; }
    public function deleteSite($siteId) { return array('siteId' => (string) $siteId); }
    public function suspendSite($siteId) { return array('siteId' => (string) $siteId); }

    public function activatePlugin(array $input)
    {
        $this->calls['activatePlugin'] = $input;
        return array('operation' => 'activatePlugin', 'input' => $input);
    }

    public function switchTheme(array $input)
    {
        $this->calls['switchTheme'] = $input;
        return array('operation' => 'switchTheme', 'input' => $input);
    }

    public function createUser(array $input)
    {
        $this->calls['createUser'] = $input;
        return array('operation' => 'createUser', 'input' => $input);
    }

    public function updateOption(array $input)
    {
        $this->calls['updateOption'] = $input;
        return array('operation' => 'updateOption', 'input' => $input);
    }
}

final class EndpointsTest
{
    public static function run()
    {
        self::activatesPluginThroughService();
        self::switchesThemeThroughService();
        self::createsUserThroughService();
        self::updatesOptionThroughService();
        self::rejectsInvalidInputsBeforeAdapterCalls();
        self::siteServiceDelegatesToValidatedServices();
    }

    private static function activatesPluginThroughService()
    {
        $adapter = new EndpointFakeWordPressAdapter();
        $result = (new PluginService($adapter))->activatePlugin(array(
            'siteId' => '7',
            'plugin' => 'platform/platform.php',
            'networkWide' => true,
        ));

        self::same(array(
            'operation' => 'activatePlugin',
            'input' => array('siteId' => '7', 'plugin' => 'platform/platform.php', 'networkWide' => true),
        ), $result, 'plugin activation result');
    }

    private static function switchesThemeThroughService()
    {
        $adapter = new EndpointFakeWordPressAdapter();
        (new ThemeService($adapter))->switchTheme(array('siteId' => 8, 'theme' => 'storefront'));

        self::same(array('siteId' => '8', 'theme' => 'storefront'), $adapter->calls['switchTheme'], 'theme input');
    }

    private static function createsUserThroughService()
    {
        $adapter = new EndpointFakeWordPressAdapter();
        (new UserService($adapter))->createUser(array(
            'siteId' => '9',
            'username' => 'admin',
            'email' => ' admin@example.test ',
            'role' => 'administrator',
            'password' => 'secret',
        ));

        self::same(array(
            'siteId' => '9',
            'username' => 'admin',
            'email' => 'admin@example.test',
            'role' => 'administrator',
            'password' => 'secret',
        ), $adapter->calls['createUser'], 'user input');
    }

    private static function updatesOptionThroughService()
    {
        $adapter = new EndpointFakeWordPressAdapter();
        (new OptionService($adapter))->updateOption(array(
            'siteId' => '10',
            'name' => 'platform_mode',
            'value' => array('enabled' => true),
        ));

        self::same(array(
            'siteId' => '10',
            'name' => 'platform_mode',
            'value' => array('enabled' => true),
        ), $adapter->calls['updateOption'], 'option input');
    }

    private static function rejectsInvalidInputsBeforeAdapterCalls()
    {
        $cases = array(
            array(new PluginService(new EndpointFakeWordPressAdapter()), 'activatePlugin', array('siteId' => '0', 'plugin' => 'x/x.php')),
            array(new PluginService(new EndpointFakeWordPressAdapter()), 'activatePlugin', array('siteId' => '1', 'plugin' => 'x/x.php', 'networkWide' => 'yes')),
            array(new ThemeService(new EndpointFakeWordPressAdapter()), 'switchTheme', array('siteId' => '1', 'theme' => '')),
            array(new UserService(new EndpointFakeWordPressAdapter()), 'createUser', array('siteId' => '1', 'username' => 'admin', 'email' => 'bad', 'role' => 'subscriber')),
            array(new OptionService(new EndpointFakeWordPressAdapter()), 'updateOption', array('siteId' => '1', 'name' => 'mode')),
        );

        foreach ($cases as $case) {
            self::throwsInvalidArgument(function () use ($case) {
                call_user_func(array($case[0], $case[1]), $case[2]);
            }, 'invalid endpoint input');
        }
    }

    private static function siteServiceDelegatesToValidatedServices()
    {
        $adapter = new EndpointFakeWordPressAdapter();
        $service = new SiteService($adapter);

        $service->activatePlugin(array('siteId' => '11', 'plugin' => 'x/x.php'));
        $service->switchTheme(array('siteId' => '11', 'theme' => 'storefront'));
        $service->createUser(array('siteId' => '11', 'username' => 'admin', 'email' => 'admin@example.test', 'role' => 'admin'));
        $service->updateOption(array('siteId' => '11', 'name' => 'mode', 'value' => 'active'));

        self::same('11', $adapter->calls['activatePlugin']['siteId'], 'site service plugin delegation');
        self::same('11', $adapter->calls['switchTheme']['siteId'], 'site service theme delegation');
        self::same('11', $adapter->calls['createUser']['siteId'], 'site service user delegation');
        self::same('11', $adapter->calls['updateOption']['siteId'], 'site service option delegation');
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

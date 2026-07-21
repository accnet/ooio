<?php
/**
 * Plugin Name: Platform Core
 * Description: Localhost-only WordPress data-plane REST skeleton.
 */

defined('ABSPATH') || exit;

$platform_core_autoload = __DIR__ . '/vendor/autoload.php';
if (is_readable($platform_core_autoload)) {
    require_once $platform_core_autoload;
} else {
    spl_autoload_register(static function ($class) {
        $prefix = 'PlatformCore\\';
        if (strpos($class, $prefix) !== 0) {
            return;
        }

        $relative = str_replace('\\', '/', substr($class, strlen($prefix)));
        $file = __DIR__ . '/src/' . $relative . '.php';
        if (is_readable($file)) {
            require_once $file;
        }
    });
}

add_action('rest_api_init', static function () {
    $adapter = new \PlatformCore\Adapter\CoreWordPressAdapter();
    $service = new \PlatformCore\Service\SiteService($adapter);
    $controller = new \PlatformCore\Rest\Controller($service);
    $controller->register_routes();
});


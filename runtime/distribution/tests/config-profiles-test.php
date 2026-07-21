<?php

$configDirectory = __DIR__ . '/../config';
$failures = [];

$assert = static function (bool $condition, string $message) use (&$failures): void {
    if (!$condition) {
        $failures[] = $message;
    }
};

$profiles = [];
foreach (['default', 'performance', 'security'] as $profileName) {
    $path = $configDirectory . '/' . $profileName . '.php';
    try {
        $profile = require $path;
    } catch (Throwable $exception) {
        $assert(false, $profileName . ' profile threw: ' . $exception->getMessage());
        continue;
    }

    $assert(is_array($profile), $profileName . ' profile must return an array');
    $assert(($profile['profile'] ?? null) === $profileName, $profileName . ' profile name is incorrect');
    $assert(isset($profile['constants']) && is_array($profile['constants']), $profileName . ' constants are missing');
    $profiles[$profileName] = $profile;
}

$assert(($profiles['performance']['constants']['WP_CACHE'] ?? null) === true, 'performance must enable WP_CACHE');
$assert(($profiles['performance']['constants']['WP_REDIS_HOST'] ?? null) === '127.0.0.1', 'performance must configure Redis');
$assert(($profiles['performance']['constants']['DISABLE_WP_CRON'] ?? null) === true, 'performance must disable WP-Cron');
$assert(($profiles['security']['constants']['DISALLOW_FILE_EDIT'] ?? null) === true, 'security must disable file editing');
$assert(($profiles['security']['constants']['FORCE_SSL_ADMIN'] ?? null) === true, 'security must force SSL for admin');
$assert(($profiles['security']['constants']['WP_AUTO_UPDATE_CORE'] ?? null) === 'minor', 'security must enable minor core updates');
$assert(($profiles['security']['constants']['WP_POST_REVISIONS'] ?? null) === 10, 'security must limit post revisions');

$loader = $configDirectory . '/loader.php';
$loaderOutput = [];
$loaderExitCode = 0;
$loaderCode = 'putenv("WP_DISTRIBUTION_PROFILE=security"); $config = require ' . var_export($loader, true) . '; echo $config["profile"];';
exec(escapeshellarg(PHP_BINARY) . ' -r ' . escapeshellarg($loaderCode), $loaderOutput, $loaderExitCode);
$assert($loaderExitCode === 0, 'loader subprocess must exit successfully');
$assert(implode('', $loaderOutput) === 'security', 'loader must select the environment profile');

if ($failures !== []) {
    foreach ($failures as $failure) {
        fwrite(STDERR, 'FAIL: ' . $failure . PHP_EOL);
    }
    exit(1);
}

fwrite(STDOUT, "PASS: all distribution config profiles load correctly\n");

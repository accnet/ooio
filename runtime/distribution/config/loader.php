<?php

$profile = null;
if (defined('WP_DISTRIBUTION_PROFILE')) {
    $profile = constant('WP_DISTRIBUTION_PROFILE');
} else {
    $environmentProfile = getenv('WP_DISTRIBUTION_PROFILE');
    $profile = $environmentProfile === false || $environmentProfile === ''
        ? 'default'
        : $environmentProfile;
}

if (!is_string($profile) || !in_array($profile, ['default', 'performance', 'security'], true)) {
    throw new InvalidArgumentException('Invalid WP distribution profile.');
}

$default = require __DIR__ . '/default.php';
$selected = $profile === 'default'
    ? $default
    : require __DIR__ . '/' . $profile . '.php';

$config = array_replace_recursive($default, $selected);
$appliedConstants = [];

foreach ($config['constants'] as $name => $value) {
    if (defined($name)) {
        $appliedConstants[$name] = false;
        continue;
    }

    define($name, $value);
    $appliedConstants[$name] = true;
}

$config['applied_constants'] = $appliedConstants;

return $config;

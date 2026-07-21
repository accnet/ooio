<?php

return [
    'profile' => 'performance',
    'constants' => [
        'WP_CACHE' => true,
        'WP_REDIS_HOST' => '127.0.0.1',
        'WP_REDIS_PORT' => 6379,
        'WP_REDIS_DATABASE' => 0,
        'WP_REDIS_TIMEOUT' => 1,
        'WP_REDIS_READ_TIMEOUT' => 1,
        'DISABLE_WP_CRON' => true,
        'WP_CRON_LOCK_TIMEOUT' => 60,
    ],
    'object_cache' => [
        'enabled' => true,
        'backend' => 'redis',
    ],
];

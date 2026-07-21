<?php

require_once __DIR__ . '/SiteServiceTest.php';
require_once __DIR__ . '/EndpointsTest.php';

try {
    SiteServiceTest::run();
    fwrite(STDOUT, "SiteServiceTest: PASS\n");
    EndpointsTest::run();
    fwrite(STDOUT, "EndpointsTest: PASS\n");
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'MU Plugin tests: FAIL - ' . $exception->getMessage() . "\n");
    exit(1);
}

'use strict';
// Test-only startup accounting. Production timeouts are not imported or changed.
const materializeMs = 10000, runtimeMs = 20000, seedMs = 10000;
const initializationAllowanceMs = 15000;
const readinessMs = materializeMs + runtimeMs + seedMs + initializationAllowanceMs;
const shutdownMs = materializeMs + 5000;
const lowCpuIsolation = process.env.CHUNLACK_TEST_LOW_CPU === '1';
const loginMs = lowCpuIsolation ? 10000 : 3000;
module.exports = Object.freeze({materializeMs, runtimeMs, seedMs, readinessMs, shutdownMs, loginMs,
  testMs: readinessMs + shutdownMs + (lowCpuIsolation ? 20000 : 15000)});

'use strict';
// Standalone bounded acceptance, intentionally outside the unit-test glob.
async function main() {
  const options = {'--duration-ms': 60000, '--max-rounds': 100, '--mock-delay-ms': 100}, args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    if (!Object.hasOwn(options, args[i]) || args[i + 1] === undefined || !/^\d+$/.test(args[i + 1])) throw new Error('soak_invalid_arguments');
    options[args[i]] = Number(args[i + 1]);
  }
  const duration = options['--duration-ms'], cap = options['--max-rounds'], mockDelayMs = options['--mock-delay-ms'];
  if (!Number.isSafeInteger(duration) || duration < 1000 || duration > 1800000) throw new Error('soak_invalid_duration');
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 1000) throw new Error('soak_invalid_round_cap');
  if (!Number.isSafeInteger(mockDelayMs) || mockDelayMs > 500) throw new Error('invalid_mock_delay');
  if (!process.env.CADDY_TEST_BIN) throw new Error('soak_requires_caddy');
  const {createPackagedAgentScenario} = require('./helpers/packaged-agent-scenario.cjs');
  let stopping = false, scenario;
  const stop = () => {stopping = true;}; process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    scenario = await createPackagedAgentScenario({caddyBin: process.env.CADDY_TEST_BIN, mockDelayMs});
    const begin = Date.now(); let index = 0;
    while (!stopping && Date.now() - begin < duration && index < cap) {await Promise.all([scenario.round('A', index), scenario.round('B', index)]); index++;}
    const elapsed = Date.now() - begin, report = {...scenario.report(), requestedDurationMs: duration, sustainedDurationMs: elapsed, durationMet: elapsed >= duration, interrupted: stopping};
    if (stopping || !report.durationMet || report.failedRounds || report.privacyFailures || report.maxActiveModelHTTP !== 1 || index < 1) process.exitCode = 2;
    console.log(JSON.stringify(report));
  } catch (error) {if (scenario) console.error(JSON.stringify({...scenario.report(), accepted: false})); throw error;}
  finally {process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); if (scenario) await scenario.close();}
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});

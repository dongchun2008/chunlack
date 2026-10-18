"""Portable regression checks; real mount/lifecycle drills run separately on Linux."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('launcher', Path(__file__).with_name('launch-controlled-release.py'))
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def arguments(self):
        return launcher.release_arguments('/var/lib/chunlack-release-abcdef012345')

    def test_atomic_write_parent_is_writable(self):
        value = next(v for v in self.arguments() if v.startswith('--property=ReadWritePaths='))
        paths = value.split('=', 2)[2].split()
        self.assertIn('/etc/chunlack-public', paths)
        self.assertNotIn('/etc/chunlack-public/Caddyfile', paths)

    def test_credentials_and_runtime_remain_readonly(self):
        self.assertIn('--property=ReadOnlyPaths=/opt/chunlack-public/runtime /etc/chunlack-public/runtime.env', self.arguments())

    def test_resource_and_recovery_grace_budgets(self):
        args = self.arguments()
        for value in ('MemoryMax=192M', 'CPUQuota=10%', 'TasksMax=32', 'RuntimeMaxSec=180', 'TimeoutStopSec=130'):
            self.assertIn('--property=' + value, args)

    def test_controller_can_reach_only_loopback(self):
        args = self.arguments()
        self.assertIn('--property=IPAddressDeny=any', args)
        self.assertIn('--property=IPAddressAllow=localhost', args)

    def test_unit_and_command_bind_same_root(self):
        args = self.arguments()
        self.assertIn('--unit=chunlack-prod-release-abcdef012345.service', args)
        self.assertEqual(args[-4:], ['/usr/bin/python3', '-B', '/var/lib/chunlack-release-abcdef012345/release.py', '/var/lib/chunlack-release-abcdef012345'])

    def test_noncanonical_roots_are_rejected(self):
        for value in (None, '', '/tmp/abcdef012345', '/var/lib/chunlack-release-ABCDEF012345', '/var/lib/chunlack-release-abcdef012345/', '/var/lib/chunlack-release-abcdef012345/../other', '/var/lib//chunlack-release-abcdef012345'):
            with self.subTest(root=value), self.assertRaises(ValueError):
                launcher.release_arguments(value)

    def test_unix_time_has_no_cst_utc_interpretation(self):
        result = launcher.audit_elapsed('@1792365579\n', 1792365629583000000)
        self.assertEqual(result['status'], 'passed')
        self.assertAlmostEqual(result['elapsedUpperBoundSeconds'], 50.583)

    def test_fractional_unix_time_is_preserved(self):
        self.assertEqual(launcher.audit_elapsed('@100.123456789', 100123456790)['elapsedUpperBoundSeconds'], 0.000000001)

    def test_negative_duration_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'negative_elapsed_time'):
            launcher.audit_elapsed('@1792365579', 1792365578000000000)

    def test_120_second_boundary_is_exact(self):
        self.assertTrue(launcher.audit_elapsed('@100', 220000000000)['within120Seconds'])
        self.assertEqual(launcher.audit_elapsed('@100', 220000000001)['status'], 'failed')

    def test_zero_duration_is_valid(self):
        self.assertEqual(launcher.audit_elapsed('@100', 100000000000)['elapsedUpperBoundSeconds'], 0)

    def test_localized_and_invalid_time_inputs_are_rejected(self):
        for value in (None, 'n/a', '@0', '@-1', '@1.1234567890', 'Mon 2026-10-19 07:20:19 CST', '1792365579', '@nan'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                launcher.audit_elapsed(value, 1792365629583000000)

    def test_boolean_end_time_is_not_an_integer_timestamp(self):
        with self.assertRaises(ValueError):
            launcher.audit_elapsed('@100', True)


if __name__ == '__main__':
    unittest.main()

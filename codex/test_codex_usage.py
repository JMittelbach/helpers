import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import codex_usage as usage


class CreditsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.cache = str(Path(self.temp.name) / 'credits.json')

    def render(self, credits, total=None, account='test-account'):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            usage.print_credits(json.dumps({'account_id': account, 'credits': credits}),
                                total=total, cache_path=self.cache)
        return output.getvalue()

    def test_live_shape_and_declining_balance(self):
        first = self.render({'balance': '62121.8007870000', 'has_credits': True})
        self.assertIn('0.0% used', first)
        self.assertIn('62,121.80 credits remaining', first)
        self.assertNotIn('Reference:', first)
        self.assertIn('░' * 30, first)
        second = self.render({'balance': '31060.9003935'})
        self.assertIn('50.0% used', second)
        self.assertIn('█' * 15 + '░' * 15, second)
        self.assertNotIn('test-account', Path(self.cache).read_text())

    def test_top_up_and_account_isolation(self):
        self.render({'balance': 100})
        self.assertIn('0.0% used', self.render({'balance': 200}))
        self.assertIn('50.0% used', self.render({'balance': 100}))
        self.assertIn('0.0% used', self.render({'balance': 10}, account='other'))

    def test_explicit_total_does_not_write_cache(self):
        output = self.render({'balance': 25}, total=100)
        self.assertIn('75.0% used', output)
        self.assertIn('█' * 22 + '░' * 8, output)
        self.assertNotIn('Reference:', output)
        self.assertFalse(Path(self.cache).exists())
        self.assertIn('0.0% used', self.render({'balance': 125}, total=100))

    def test_zero_and_negative(self):
        self.render({'balance': 100})
        self.assertIn('100.0% used', self.render({'balance': 0}))
        self.assertIn('100.0% used', self.render({'has_credits': False}))
        self.assertIn('-2.00 credits remaining', self.render({'balance': -2}))

    def test_zero_without_reference(self):
        self.assertIn('percentage unavailable', self.render({'balance': 0}))

    def test_unlimited_and_missing(self):
        self.assertIn('unlimited', self.render({'unlimited': True}))
        self.assertIn('not provided', self.render(None))
        for value in (None, 'bad', 'nan', 'inf', True):
            with self.subTest(value=value):
                self.assertIn('not provided', self.render({'balance': value}))
        self.assertFalse(Path(self.cache).exists())

    def test_invalid_body(self):
        for body in ('invalid', '[]', None):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                usage.print_credits(body, cache_path=self.cache)
            self.assertIn('not provided', output.getvalue())

    def test_cache_failure_and_missing_account(self):
        with patch.object(usage.os, 'makedirs', side_effect=PermissionError):
            self.assertIn('percentage unavailable', self.render({'balance': 10}))
        self.assertIn('percentage unavailable', self.render({'balance': 10}, account=None))
        Path(self.cache).write_text('invalid json')
        self.assertIn('0.0% used', self.render({'balance': 10}))

    def test_cli_total_validation(self):
        for value in ('0', '-1', 'nan', 'inf', 'abc'):
            with self.assertRaises(usage.argparse.ArgumentTypeError):
                usage.positive_number(value)
        self.assertEqual(usage.positive_number('100.5'), 100.5)

    def test_existing_weekly_quota_mapping(self):
        quotas = usage.parse_quota_payload({'rate_limit': {
            'primary_window': {'used_percent': 100, 'limit_window_seconds': 604800,
                               'reset_after_seconds': 60}, 'secondary_window': None}}, {})
        self.assertEqual(quotas, {'7d': (100.0, 60)})

    def test_main_includes_credits_and_tokens(self):
        stats = dict(all_time=100, today=10, last_5h=5, last_7d=50, daily={})
        with patch.object(usage, 'fetch_codex_usage', return_value=(200, {},
                '{"credits":{"balance":"50"},"rate_limit":{"primary_window":{"used_percent":10}}}')), \
             patch.object(usage, 'local_token_stats', return_value=stats), \
             patch('sys.argv', ['tokens', '--credits-total', '100']), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            usage.main()
        self.assertIn('50.0% used', output.getvalue())
        self.assertIn('Local tokens used', output.getvalue())
        self.assertNotIn('Error:', output.getvalue())


if __name__ == '__main__':
    unittest.main()

import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

source = pathlib.Path(__file__).resolve().parents[1] / 'tools' / 'diagnose-forwarding.py'
spec = importlib.util.spec_from_file_location('forward_diagnostic', source)
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)
RULE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
EPOCH = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
TEXT = 'gost_services 1\ngost_service_transfer_input_bytes_total{service="a"} 100\ngost_service_transfer_output_bytes_total{service="a"} 200\n'


class DiagnosticTest(unittest.TestCase):
    def test_parser_and_legacy_gap(self):
        totals, legacy, seen = diag.parse_metrics(TEXT)
        self.assertEqual(totals, {'rx': 100, 'tx': 200, 'errors': 0})
        self.assertEqual(totals, legacy)
        self.assertTrue(seen)
        totals, legacy, seen = diag.parse_metrics('gost_service_transfer_input_bytes_total{service="with space"} 1e2\ngost_service_transfer_output_bytes_total 200 123\n')
        self.assertEqual(totals['rx'], 100)
        self.assertEqual(totals['tx'], 200)
        self.assertEqual(legacy['rx'] + legacy['tx'], 0)
        totals, _, seen = diag.parse_metrics('gost_service_transfer_input_bytes_total NaN\ngost_service_transfer_output_bytes_total -4\ngost_service_handler_errors_total 0\n')
        self.assertFalse(seen)
        self.assertEqual(totals['rx'] + totals['tx'], 0)

    def test_http_capture_limits_and_redirect(self):
        body = TEXT.encode()
        redirect = False

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302 if redirect else 200)
                if redirect:
                    self.send_header('Location', 'http://invalid.example/should-not-be-contacted')
                self.end_headers()
                if not redirect:
                    self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                path = pathlib.Path(directory) / (RULE + '.json')
                path.write_text(json.dumps({'id': RULE, 'epoch': EPOCH, 'port': server.server_port}), encoding='utf-8')
                result = diag.collect(str(path))
                self.assertTrue(result['ok'], result)
                self.assertEqual(result['totals']['rx'], 100)
                self.assertFalse(result['agent_limit'])
                body = b'# comment\n' * 30000 + TEXT.encode()
                result = diag.collect(str(path))
                self.assertTrue(result['ok'], result)
                self.assertTrue(result['agent_limit'])
                self.assertEqual(result['totals']['tx'], 200)
                redirect = True
                result = diag.collect(str(path))
                self.assertFalse(result['ok'])
                self.assertEqual(result['error'], 'HTTPError')
                self.assertNotIn('invalid.example', json.dumps(result))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_restart_while_reading_is_not_paired(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self, size):
                path.write_text(json.dumps({'id': RULE, 'epoch': 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa', 'port': 12345}), encoding='utf-8')
                return TEXT.encode()

        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / (RULE + '.json')
            path.write_text(json.dumps({'id': RULE, 'epoch': EPOCH, 'port': 12345}), encoding='utf-8')
            with patch.object(diag.urllib.request.OpenerDirector, 'open', return_value=Response()):
                result = diag.collect(str(path))
            self.assertFalse(result['ok'])
            self.assertIn('重启', result['error'])

    def test_snapshot_is_bounded_and_keeps_invalid_samples(self):
        with patch.object(diag.glob, 'glob', return_value=['one.json', 'two.json']), patch.object(diag, 'network', return_value={'eth0': {'rx': 10, 'tx': 20}}), patch.object(diag, 'tcp_stats', return_value={}), patch.object(diag, 'collect', side_effect=lambda path: {'file': path, 'ok': False, 'error': 'fixture'}):
            snapshot = diag.snapshot()
            self.assertEqual(len(snapshot['samples']), 2)
            self.assertEqual(snapshot['after']['eth0']['tx'], 20)

    def test_interval_comparison_and_incomplete_guard(self):
        def sample(rx, tx):
            return {'id': RULE, 'epoch': EPOCH, 'port': 12345, 'ok': True, 'agent_marker': True, 'totals': {'rx': rx, 'tx': tx, 'errors': 0}}

        first = {'before': {'eth0': {'rx': 100, 'tx': 100}}, 'after': {'eth0': {'rx': 110, 'tx': 110}}, 'samples': {'one': sample(100, 200)}, 'tcp': {'RetransSegs': 1, 'OutSegs': 10}}
        second = {'before': {'eth0': {'rx': 150, 'tx': 160}}, 'after': {'eth0': {'rx': 160, 'tx': 170}}, 'samples': {'one': sample(120, 230)}, 'tcp': {'RetransSegs': 3, 'OutSegs': 20}}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            diag.compare(first, second, 'eth0')
        self.assertIn('有效配对 1 / 1', output.getvalue())
        self.assertIn('1.800 — 2.600', output.getvalue())
        self.assertIn('重传段增量 2', output.getvalue())
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            diag.compare(first, second, 'eth0', ['cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa'])
        self.assertIn('额外清单 1', output.getvalue())
        self.assertIn('未见清单 1', output.getvalue())
        second['samples']['one']['epoch'] = 'cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa'
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            diag.compare(first, second, 'eth0')
        self.assertIn('不可配对 1', output.getvalue())
        self.assertNotIn('网卡 / GOST 区间比', output.getvalue())
        self.assertIn('不能还原', output.getvalue())

    def test_script_does_not_read_agent_credentials(self):
        text = source.read_text(encoding='utf-8')
        self.assertNotIn('/etc/lightprobe-agent.json', text)
        self.assertNotIn('systemctl', text)
        compile(text, str(source), 'exec')


if __name__ == '__main__':
    unittest.main()

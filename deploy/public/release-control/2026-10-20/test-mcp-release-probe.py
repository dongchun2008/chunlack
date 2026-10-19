"""MCP release probe framing regression; no real network or credentials."""
import importlib.util, json, os, sys, tempfile, unittest
from pathlib import Path
controller = Path(os.environ.get("CHUNLACK_TEST_CONTROLLER",
    str(Path(__file__).resolve().parents[1] / "2026-10-17" / "release-discovery-safe-20261017.py")))
spec = importlib.util.spec_from_file_location("mcp_release_probe_gate", controller)
gate = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = gate
spec.loader.exec_module(gate)

class ProbeFramingTests(unittest.TestCase):
    def request(self, path="/mcp", method="POST"):
        backend = object.__new__(gate.LinuxBackend)
        backend.w = gate.Window()
        captured = {}
        def command(arguments, cap):
            captured.update(arguments=arguments, cap=cap)
            return 'HTTP/2 401\r\nWWW-Authenticate: Bearer resource_metadata="https://agents.example/mcp"\r\n\r\n{"error":"unauthorized"}'
        backend.command = command
        reply = backend.request("agents.chunclaw.top", path, method)
        return captured, reply
    def test_mcp_post_has_valid_json_ping(self):
        captured, _ = self.request()
        args = captured["arguments"]
        self.assertIn("Content-Type: application/json", args)
        self.assertIn("--data-binary", args)
        body = json.loads(args[args.index("--data-binary") + 1])
        self.assertEqual(body, {"jsonrpc":"2.0","id":1,"method":"ping","params":{}})
    def test_mcp_get_keeps_empty_body(self):
        captured, _ = self.request(method="GET")
        self.assertNotIn("--data-binary", captured["arguments"])
        self.assertNotIn("Content-Type: application/json", captured["arguments"])
    def test_rest_post_keeps_existing_bodyless_probe(self):
        captured, _ = self.request(path="/v1/tasks/claim")
        self.assertNotIn("--data-binary", captured["arguments"])
        self.assertNotIn("Content-Type: application/json", captured["arguments"])
    def test_fixed_invalid_bearer_header_preserved(self):
        captured, _ = self.request()
        self.assertEqual(captured["arguments"].count("Authorization: Bearer discovery-denial-probe"), 1)
    def test_certificate_and_loopback_checks_preserved(self):
        captured, _ = self.request()
        args = captured["arguments"]
        self.assertEqual(args[args.index("--resolve") + 1], "agents.chunclaw.top:443:127.0.0.1")
        self.assertEqual(args[args.index("--noproxy") + 1], "*")
        self.assertEqual(args[-1], "https://agents.chunclaw.top/mcp")
        for forbidden in ("-k", "--insecure", "-L", "--location"):
            self.assertNotIn(forbidden, args)
    def test_request_budgets_preserved(self):
        captured, _ = self.request()
        args = captured["arguments"]
        self.assertEqual(float(args[args.index("--max-time") + 1]), 2)
        self.assertEqual(float(args[args.index("--connect-timeout") + 1]), 1)
        self.assertEqual(captured["cap"], 3)
    def test_response_status_and_challenge_preserved(self):
        _, reply = self.request()
        self.assertEqual(reply[0], 401)
        self.assertIn("resource_metadata=", reply[1])
        self.assertEqual(json.loads(reply[2]), {"error":"unauthorized"})

class AcceptanceAssertionsTests(unittest.TestCase):
    def backend(self, status=401, challenge=True, bad_rest=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        backend = object.__new__(gate.LinuxBackend)
        backend.data = Path(temporary.name)
        (backend.data / "config").mkdir()
        config = {"publicRuntime":{"nodeRestPublic":False,"agentOAuth":{
            "enabled":True,"discoveryOnly":False,"clientIds":["synthetic-client"],
            "browserClientId":"synthetic-browser"}}}
        (backend.data / "config/lack.config.json").write_text(json.dumps(config))
        backend.release_profile = "mcp-only"
        backend.approved_agent_client_ids = ("synthetic-client",)
        backend.assert_listener = lambda mode: None
        backend.check_backend_rest = lambda config: None
        backend.check_protected = lambda: None
        calls = []
        def request(host, path, method="GET"):
            calls.append((host,path,method))
            if path == "/health": return 200, "", "{}"
            if path.startswith("/.well-known/"):
                return 200, "", json.dumps({"resource":"https://agents.chunclaw.top/mcp",
                    "authorization_servers":["https://pockid.chunclaw.top"]})
            if path == "/mcp": return status, 'resource_metadata="fixture"' if challenge else "", "{}"
            return (200 if path == bad_rest else 404), "", "{}"
        backend.request = request
        return backend, calls
    def test_candidate_accepts_only_401_with_challenge(self):
        backend, calls = self.backend()
        backend.check_candidate("loopback")
        self.assertEqual([m for h,p,m in calls if p == "/mcp"], ["GET","POST"])
    def test_candidate_rejects_missing_challenge(self):
        backend, _ = self.backend(challenge=False)
        with self.assertRaisesRegex(RuntimeError, "mcp_not_denied"):
            backend.check_candidate("loopback")
    def test_candidate_rejects_200_403_and_413(self):
        for status in (200,403,413):
            with self.subTest(status=status):
                backend, _ = self.backend(status=status)
                with self.assertRaisesRegex(RuntimeError, "mcp_not_denied"):
                    backend.check_candidate("loopback")
    def test_candidate_still_checks_all_public_rest_routes(self):
        backend, _ = self.backend(bad_rest="/v1/future-route")
        with self.assertRaisesRegex(RuntimeError, "rest_not_denied"):
            backend.check_candidate("loopback")

if __name__ == "__main__":
    unittest.main(verbosity=2)

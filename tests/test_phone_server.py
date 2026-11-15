"""Real HTTP integration tests for the local-only controller relay."""
import http.client
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import subprocess
import threading
import unittest

SPEC = importlib.util.spec_from_file_location("rover_local_server", Path(__file__).resolve().parents[1] / "server.py")
relay = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = relay
SPEC.loader.exec_module(relay)


class PhoneServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "game"
        self.root.mkdir()
        (self.root / "index.html").write_text("<h1>Ghost Rovers</h1>")
        (self.root / "phone.html").write_text("<h1>Phone</h1>")
        (self.root / ".secret").write_text("private")
        (Path(self.temp.name) / "outside.txt").write_text("outside")
        (self.root / "escape.txt").symlink_to(Path(self.temp.name) / "outside.txt")
        (self.root / "hidden-alias.txt").symlink_to(self.root / ".secret")
        self.now = 100.0
        self.server = relay.RoverServer(("127.0.0.1", 0), self.root, lambda: self.now)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.host = f"127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        headers = dict(headers or {})
        if isinstance(body, dict):
            body = json.dumps(body)
            headers.setdefault("Content-Type", "application/json")
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        value = json.loads(raw) if response.getheader("Content-Type", "").startswith("application/json") else raw.decode()
        status = response.status
        connection.close()
        return status, value

    def create(self):
        status, room = self.request("POST", "/api/phone/create", {})
        self.assertEqual(status, 200)
        self.assertRegex(room["room"], r"^\d{6}$")
        self.assertGreaterEqual(len(room["hostToken"]), 32)
        return room

    def join(self, room):
        status, phone = self.request("POST", "/api/phone/join", {"room": room["room"]})
        self.assertEqual(status, 200)
        return phone["controllerToken"]

    def state(self, room, token=None):
        return self.request("GET", "/api/phone/state?room=" + room["room"], headers={"X-Rover-Host": token or room["hostToken"]})

    def input(self, room, token, **values):
        return self.request("POST", "/api/phone/input", {"room": room["room"], "controllerToken": token,
                            "steer": 0, "gas": 0, "brake": 0, "buttons": {}, **values})

    def test_pairing_auth_clamp_and_button_edges(self):
        room = self.create()
        self.assertEqual(self.state(room, "wrong")[0], 403)
        phone = self.join(room)
        self.assertEqual(self.input(room, "wrong")[0], 403)
        self.assertEqual(self.input(room, "👻")[0], 403)
        self.assertEqual(self.input(room, phone, steer=3, gas=4, brake=-2, buttons={"cross": True})[0], 200)
        status, state = self.state(room)
        self.assertEqual(status, 200)
        self.assertEqual((state["steer"], state["gas"], state["brake"]), (1, 1, 0))
        self.assertTrue(state["connected"])
        self.assertEqual(state["pressed"], ["cross"])
        self.assertTrue(state["down"]["cross"])
        self.assertEqual(self.state(room)[1]["pressed"], [])
        self.input(room, phone, buttons={"cross": True})
        self.assertEqual(self.state(room)[1]["pressed"], [], "held buttons do not repeat edges")
        self.input(room, phone)
        self.assertFalse(self.state(room)[1]["down"]["cross"])
        self.input(room, phone, buttons={"cross": True, "options": True})
        self.assertEqual(self.state(room)[1]["pressed"], ["cross", "options"])

    def test_stale_neutral_and_replacement(self):
        room = self.create()
        old_phone = self.join(room)
        self.input(room, old_phone, steer=-1, gas=1, buttons={"cross": True})
        self.assertEqual(self.request("POST", "/api/phone/join", {"room": room["room"]})[0], 409)
        self.now += .71
        state = self.state(room)[1]
        self.assertFalse(state["connected"])
        self.assertEqual((state["steer"], state["gas"], state["brake"]), (0, 0, 0))
        self.assertFalse(any(state["down"].values()))
        self.assertEqual(state["pressed"], [])
        phone = self.join(room)
        self.assertNotEqual(phone, old_phone)
        self.assertEqual(self.input(room, old_phone, gas=1)[0], 403)
        self.assertTrue(self.state(room)[1]["connected"])
        self.assertEqual(self.state(room)[1]["pressed"], [])
        self.assertEqual(self.state(room)[1]["gas"], 0)
        self.input(room, phone, buttons={"cross": True})
        self.assertEqual(self.state(room)[1]["pressed"], ["cross"])

    def test_queue_bounded_and_gap_discards_old_edges(self):
        room = self.create()
        phone = self.join(room)
        for _ in range(40):
            self.input(room, phone, buttons={"cross": True})
            self.input(room, phone)
        self.assertEqual(len(self.state(room)[1]["pressed"]), 32)
        self.input(room, phone, buttons={"cross": True})
        self.now += 1
        self.input(room, phone, buttons={"circle": True})
        self.assertEqual(self.state(room)[1]["pressed"], ["circle"])

    def test_origin_json_validation_and_body_limit(self):
        for method, path, body in (("GET", "/api/phone/info", None), ("POST", "/api/phone/create", {})):
            self.assertEqual(self.request(method, path, body, {"Origin": "http://other.invalid"})[0], 403)
            self.assertEqual(self.request(method, path, body, {"Origin": "null"})[0], 403)
            self.assertEqual(self.request(method, path, body, {"Origin": "http://["})[0], 403)
            self.assertEqual(self.request(method, path, body, {"Origin": "http://" + self.host})[0], 200)
        self.assertEqual(self.request("POST", "/api/phone/create", "{}")[0], 415)
        self.assertEqual(self.request("POST", "/api/phone/create", "not json", {"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request("POST", "/api/phone/create", {"long": "x" * 2050})[0], 413)
        room = self.create()
        phone = self.join(room)
        for bad in (float('nan'), float('inf'), "1", True):
            self.assertEqual(self.input(room, phone, steer=bad)[0], 400)
        self.assertEqual(self.input(room, phone, steer=10**500)[0], 200)
        self.assertEqual(self.state(room)[1]["steer"], 1)
        self.assertEqual(self.input(room, phone, buttons={"cross": 1})[0], 400)
        self.assertEqual(self.input(room, phone, buttons={"surprise": True})[0], 400)
        self.assertEqual(self.request("GET", "/api/phone/unknown")[0], 404)

    def test_capacity_close_and_orphan_cleanup(self):
        rooms = [self.create() for _ in range(16)]
        self.assertEqual(self.request("POST", "/api/phone/create", {})[0], 503)
        self.assertEqual(self.request("POST", "/api/phone/close", {"room": rooms[0]["room"], "hostToken": "bad"})[0], 403)
        self.assertEqual(self.request("POST", "/api/phone/close", rooms[0])[0], 200)
        self.assertEqual(self.state(rooms[0])[0], 403)
        survivor = self.create()
        self.now += 20
        self.state(survivor)
        self.now += 11
        fresh = self.create()
        self.assertEqual(len(self.server.rooms), 2)
        self.assertEqual(self.state(survivor)[0], 200)
        self.now += 3601
        self.assertEqual(self.state(fresh)[0], 403)

    def test_tls_options_and_scheme_reporting(self):
        program = str(Path(__file__).resolve().parents[1] / "server.py")
        result = subprocess.run([sys.executable, program, "--cert", "missing.pem"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("--cert and --key must be supplied together", result.stderr)
        result = subprocess.run([sys.executable, program, "--cert", "missing.pem", "--key", "missing.key"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("Cannot load TLS certificate/key", result.stderr)
        # Scheme plumbing is independent of handshake: no test certificate is
        # generated or trusted. Live TLS needs the user's trusted certificate.
        self.server.scheme = "https"
        status, info = self.request("GET", "/api/phone/info", headers={"Origin": "https://" + self.host})
        self.assertEqual(status, 200)
        self.assertEqual(info["urls"], ["https://" + self.host + "/phone.html"])
        self.assertEqual(self.request("GET", "/api/phone/info", headers={"Origin": "http://" + self.host})[0], 403)

    def test_explicit_public_https_origin_for_test_tunnel(self):
        self.server.public_url = "https://rover-example.trycloudflare.com"
        public = {"Origin": self.server.public_url}
        self.assertEqual(self.request("POST", "/api/phone/create", {}, public)[0], 200)
        self.assertEqual(self.request("GET", "/api/phone/info", headers=public)[1]["urls"], [self.server.public_url + "/phone.html"])
        for bad in ("http://rover-example.trycloudflare.com", "https://other.trycloudflare.com", self.server.public_url + "/path"):
            self.assertEqual(self.request("POST", "/api/phone/create", {}, {"Origin": bad})[0], 403)
        self.assertEqual(self.request("POST", "/api/phone/create", {}, {"Origin": "http://" + self.host})[0], 200, "local preview still works")
        (self.root / "README.md").write_text("development notes")
        self.assertEqual(self.request("GET", "/README.md")[0], 404, "tunnel serves game assets only")
        program = str(Path(__file__).resolve().parents[1] / "server.py")
        for bad in ("http://example.com", "https://example.com/path", "https://user:pass@example.com", "https://example.com?x=1"):
            result = subprocess.run([sys.executable, program, "--public-url", bad], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn("must be an HTTPS origin", result.stderr)

    def test_phone_mission_assignment_completion_and_stale_runs(self):
        room = self.create()
        token = self.join(room)
        self.input(room, token, taskReady=True)
        self.assertTrue(self.state(room)[1]["taskReady"])
        self.input(room, token)  # older neutral beacon omits capability metadata
        self.assertTrue(self.state(room)[1]["taskReady"], "release cannot drop task capability")
        mission = {"id": "a11", "runId": "first-flight", "world": "moon", "paused": False}
        def assign(value, revision, host_token=None):
            return self.request("POST", "/api/phone/mission", {**room, "hostToken": host_token or room["hostToken"], "mission": value, "revision": revision})
        self.assertEqual(assign(mission, 1, "wrong")[0], 403)
        self.assertEqual(assign({**mission, "id": "unknown"}, 1)[0], 400)
        self.assertEqual(assign(mission, 1)[0], 200)
        self.assertEqual(self.input(room, token)[1]["mission"], mission)
        self.assertEqual(assign({**mission, "paused": True}, 2)[0], 200)
        assign(mission, 1)  # reordered old request cannot unpause or resurrect a task
        self.assertTrue(self.input(room, token)[1]["mission"]["paused"])
        result = {"runId": "first-flight", "ok": True}
        self.assertEqual(self.input(room, token, missionResult=result)[1]["missionAck"], "first-flight")
        self.assertEqual(self.state(room)[1]["missionResult"], result)
        self.assertEqual(self.state(room)[1]["missionResult"], result, "host can retry its poll")
        self.input(room, token)  # delayed release/ordinary heartbeat has no result
        self.assertEqual(self.state(room)[1]["missionResult"], result, "neutral beacon cannot erase task result")
        self.input(room, token, missionResult={**result, "ok": False})
        self.assertEqual(self.state(room)[1]["missionResult"], result, "duplicate result cannot change awarded outcome")
        assign(None, 3)
        self.assertIsNone(self.state(room)[1]["missionResult"])
        second = {**mission, "runId": "second-flight"}
        assign(second, 4)
        self.input(room, token, missionResult=result)
        self.assertIsNone(self.state(room)[1]["missionResult"], "stale completion cannot finish new task")
        assign(mission, 2)
        self.assertEqual(self.input(room, token)[1]["mission"], second)
        self.assertEqual(self.input(room, "bad", missionResult={"runId": "second-flight", "ok": True})[0], 403)

    def test_context_host_auth_schema_and_direction_edges(self):
        room = self.create()
        token = self.join(room)
        context = {"screen": "book", "title": "Sticker book", "selection": "Moon", "canRead": False, "canBook": True, "canBack": True}
        def publish(value, host_token=None):
            return self.request("POST", "/api/phone/state", {**room, "hostToken": host_token or room["hostToken"], "context": value})
        self.assertEqual(publish(context, token)[0], 403, "controller cannot impersonate the host")
        self.assertEqual(publish(context, "wrong")[0], 403)
        for bad in ([], {}, {**context, "screen": "unknown"}, {**context, "title": "x" * 201},
                    {**context, "selection": None}, {**context, "canRead": 1}):
            self.assertEqual(publish(bad)[0], 400, repr(bad))
        self.assertEqual(publish({**context, "unused": "ignored"})[0], 200)
        reply = self.input(room, token, buttons={"left": True, "up": True}, context={**context, "screen": "drive"})[1]
        self.assertEqual(reply["context"], context, "phone input cannot rewrite host context")
        status, state = publish(context)
        self.assertEqual(status, 200)
        self.assertEqual(state["pressed"], ["left", "up"])
        self.assertTrue(state["down"]["left"])
        self.assertEqual(publish(context)[1]["pressed"], [], "POST polling consumes direction edges once")
        self.input(room, token)
        self.input(room, token, buttons={"right": True, "down": True})
        self.assertEqual(publish(context)[1]["pressed"], ["right", "down"])
        self.assertEqual(publish({"screen": "drive"})[0], 200)
        self.assertEqual(self.input(room, token)[1]["context"], {"screen": "drive", "title": "", "selection": "", "canRead": False, "canBook": False, "canBack": False})

    def test_input_sequence_release_reordering_and_replacement(self):
        room = self.create()
        token = self.join(room)
        self.input(room, token, sequence=1, gas=1, steer=.8, buttons={"cross": True}, taskReady=True)
        self.state(room)  # consume the real press
        self.input(room, token, sequence=3)  # newer neutral release overtakes held request
        self.input(room, token, sequence=2, gas=1, steer=.8, buttons={"cross": True})
        self.input(room, token, sequence=3, gas=1, buttons={"left": True})
        self.input(room, token, gas=1, buttons={"right": True})  # legacy unsequenced packet cannot bypass ordering
        state = self.state(room)[1]
        self.assertEqual((state["gas"], state["steer"]), (0, 0))
        self.assertFalse(any(state["down"].values()))
        self.assertEqual(state["pressed"], [], "reordered/duplicate packets cannot manufacture another edge")
        self.assertTrue(state["taskReady"], "release retains mission capability")
        for bad in (-1, True, "4", 1.5):
            self.assertEqual(self.input(room, token, sequence=bad)[0], 400)
        self.input(room, token, sequence=4, brake=1)
        self.assertEqual(self.state(room)[1]["brake"], 1, "next fresh input remains accepted")
        self.now += .71
        self.input(room, token, sequence=2, gas=1)
        self.assertFalse(self.state(room)[1]["connected"], "old input cannot keep the phone alive")
        replacement = self.join(room)
        self.assertEqual(self.input(room, token, sequence=100)[0], 403)
        self.input(room, replacement, sequence=1, gas=1)
        self.assertEqual(self.state(room)[1]["gas"], 1, "new controller token resets sequence")

    def test_persistent_connections_and_rejected_unread_bodies(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        try:
            connection.request("GET", "/api/phone/info")
            first = connection.getresponse()
            first.read()
            self.assertEqual(first.status, 200)
            self.assertEqual(first.version, 11)
            self.assertFalse(first.will_close)
            sock = connection.sock
            connection.request("GET", "/phone.html")
            second = connection.getresponse()
            self.assertEqual(second.status, 200)
            self.assertIn("Phone", second.read().decode())
            self.assertIs(connection.sock, sock, "ordinary requests reuse the connection")
            # Unsupported content type is rejected before reading this body. The
            # response must advertise closure, so its bytes cannot become a request.
            connection.request("POST", "/api/phone/create", body="not-json", headers={"Content-Type": "text/plain"})
            rejected = connection.getresponse()
            rejected.read()
            self.assertEqual(rejected.status, 415)
            self.assertTrue(rejected.will_close, "rejected unread POST must advertise Connection: close")
            connection.request("GET", "/api/phone/info")
            recovered = connection.getresponse()
            recovered.read()
            self.assertEqual(recovered.status, 200, "next request reconnects cleanly after rejection")
        finally:
            connection.close()

    def test_static_root_and_info_urls(self):
        self.assertIn("Ghost Rovers", self.request("GET", "/")[1])
        self.assertIn("Phone", self.request("GET", "/phone.html")[1])
        for path in ("/.secret", "/%2esecret", "/../outside.txt", "/%2e%2e/outside.txt", "/escape.txt", "/hidden-alias.txt", "/tests/", "/%5c..%5coutside.txt"):
            self.assertEqual(self.request("GET", path)[0], 404, path)
        status, info = self.request("GET", "/api/phone/info")
        self.assertEqual(status, 200)
        self.assertEqual(info["version"], 1)
        self.assertIn("http://" + self.host + "/phone.html", info["urls"])
        self.assertTrue(all(url.startswith("http://") and url.endswith("/phone.html") for url in info["urls"]))


if __name__ == "__main__":
    unittest.main()

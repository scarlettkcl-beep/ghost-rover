#!/usr/bin/env python3
"""Local Ghost Rovers preview and LAN phone-controller relay (stdlib only)."""
from __future__ import annotations

import argparse
from collections import deque
from dataclasses import dataclass, field
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import math
import mimetypes
from pathlib import Path
import secrets
import socket
import ssl
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit

TASK_IDS = frozenset(("a11", "a14s", "a15", "a16", "a17", "s3", "v1", "v2", "soj", "opp", "spi", "phx", "ins", "ing"))
BUTTONS = ("cross", "circle", "triangle", "square", "options", "left", "right", "up", "down")
STALE_AFTER = 0.7
ROOM_TTL = 3600
HOST_TTL = 30
MAX_ROOMS = 16
MAX_BODY = 2048
ROOT = Path(__file__).resolve().parent


def local_ipv4():
    """Read local interface addresses; never contact an address-discovery service."""
    found = set()
    try:
        import fcntl
        import struct
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            for _, name in socket.if_nameindex():
                try:
                    reply = fcntl.ioctl(sock.fileno(), 0x8915, struct.pack("256s", name.encode()[:15]))
                    address = socket.inet_ntoa(reply[20:24])
                    if not ipaddress.ip_address(address).is_loopback:
                        found.add(address)
                except OSError:
                    pass
    except (ImportError, AttributeError, OSError):
        # The machine's own hostname is the portable fallback, not a remote service.
        try:
            for result in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                address = result[4][0]
                if not ipaddress.ip_address(address).is_loopback:
                    found.add(address)
        except OSError:
            pass
    return sorted(found)


def authority(value, default_port=80):
    try:
        parsed = urlsplit("http://" + value)
        if (not parsed.hostname or parsed.username or parsed.password or parsed.path
                or parsed.query or parsed.fragment or any(c.isspace() for c in value)):
            return None
        return parsed.hostname.lower(), parsed.port or default_port
    except ValueError:
        return None


def token_matches(token, expected):
    return isinstance(token, str) and isinstance(expected, str) and hmac.compare_digest(token.encode("utf-8"), expected.encode("utf-8"))


@dataclass
class Room:
    host_token: str
    touched: float
    host_seen: float = 0
    controller_token: str | None = None
    last_input: float | None = None
    steer: float = 0
    gas: float = 0
    brake: float = 0
    down: dict = field(default_factory=lambda: dict.fromkeys(BUTTONS, False))
    edges: deque = field(default_factory=lambda: deque(maxlen=32))
    task_ready: bool = False
    mission: dict | None = None
    mission_result: dict | None = None
    mission_revision: int = 0
    context: dict | None = None
    input_sequence: int = -1

    def live(self, now):
        return self.controller_token is not None and self.last_input is not None and now - self.last_input <= STALE_AFTER

    def neutral(self):
        self.steer = self.gas = self.brake = 0
        self.down = dict.fromkeys(BUTTONS, False)
        self.edges.clear()


class RoverServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address=("0.0.0.0", 8766), root=ROOT, clock=time.monotonic, public_url=None):
        self.root = Path(root).resolve()
        self.clock = clock
        self.scheme = "http"
        self.public_url = public_url
        self.rooms = {}
        self.room_lock = threading.Lock()
        super().__init__(address, RoverHandler)

    def expire(self, now):
        for code in [code for code, room in self.rooms.items() if now - room.touched > ROOM_TTL or now - room.host_seen > HOST_TTL]:
            del self.rooms[code]


class RoverHandler(BaseHTTPRequestHandler):
    server_version = "GhostRoversLocal/1"
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(3)
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def log_message(self, fmt, *args):
        # Keep controller heartbeats and bearer tokens out of the terminal log.
        if not self.path.startswith("/api/phone/"):
            super().log_message(fmt, *args)

    def send_json(self, status, value):
        body = json.dumps(value, separators=(",", ":"), allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if self.close_connection:
            self.send_header("Connection", "close")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, message):
        # Rejected POST bodies may be unread; never reuse that connection.
        self.close_connection = True
        self.send_json(status, {"error": message})

    def same_origin(self):
        default_port = 443 if self.server.scheme == "https" else 80
        host = authority(self.headers.get("Host", ""), default_port)
        origin = self.headers.get("Origin")
        if host is None:
            self.fail(400, "A valid Host header is required")
            return False
        if origin is not None:
            try:
                parsed = urlsplit(origin)
            except ValueError:
                self.fail(403, "Phone controls must use this server's origin")
                return False
            public = urlsplit(self.server.public_url) if self.server.public_url else None
            is_public = public is not None and parsed.scheme == public.scheme and authority(parsed.netloc, 443) == authority(public.netloc, 443)
            if parsed.path or parsed.query or parsed.fragment or (not is_public and (parsed.scheme != self.server.scheme or authority(parsed.netloc, default_port) != host)):
                self.fail(403, "Phone controls must use this server's origin")
                return False
        return True

    def read_json(self):
        if self.headers.get_content_type() != "application/json":
            self.fail(415, "Use application/json")
            return None
        if self.headers.get("Transfer-Encoding"):
            self.fail(400, "Chunked requests are not supported")
            return None
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 0:
            self.fail(411, "Content-Length is required")
            return None
        if length > MAX_BODY:
            self.fail(413, "Request body is too large")
            return None
        try:
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError()
            return value
        except (ValueError, UnicodeError, RecursionError, OSError):
            self.fail(400, "Use a JSON object")
            return None

    def do_POST(self):
        path = urlsplit(self.path).path
        if not path.startswith("/api/phone/"):
            self.fail(404, "Not found")
            return
        if not self.same_origin():
            return
        body = self.read_json()
        if body is None:
            return
        if path not in ("/api/phone/create", "/api/phone/join", "/api/phone/input", "/api/phone/close", "/api/phone/mission", "/api/phone/state"):
            self.fail(404, "Not found")
            return
        now = self.server.clock()
        with self.server.room_lock:
            self.server.expire(now)
            if path == "/api/phone/create":
                if len(self.server.rooms) >= MAX_ROOMS:
                    self.fail(503, "All local controller rooms are in use")
                    return
                while True:
                    code = str(secrets.randbelow(900000) + 100000)
                    if code not in self.server.rooms:
                        break
                token = secrets.token_urlsafe(32)
                self.server.rooms[code] = Room(token, now, host_seen=now)
                self.send_json(200, {"room": code, "hostToken": token})
                return
            code = body.get("room")
            room = self.server.rooms.get(code) if isinstance(code, str) else None
            if room is None:
                self.fail(404, "Room not found; create a new code on the game")
                return
            if path == "/api/phone/close":
                token = body.get("hostToken")
                if not token_matches(token, room.host_token):
                    self.fail(403, "Host pairing is not valid")
                    return
                del self.server.rooms[code]
                self.send_json(200, {"ok": True})
                return
            if path == "/api/phone/state":
                if not token_matches(body.get("hostToken"), room.host_token):
                    self.fail(403, "Host pairing is not valid")
                    return
                context = body.get("context")
                if context is not None:
                    screens = ("drive", "lobby", "story", "book", "pause", "report", "howto", "confirm", "recovery", "task", "count")
                    if (not isinstance(context, dict) or context.get("screen") not in screens
                        or any(not isinstance(context.get(k, ""), str) or len(context.get(k, "")) > 200 for k in ("title", "selection"))
                        or any(not isinstance(context.get(k, False), bool) for k in ("canRead", "canBook", "canBack"))):
                        self.fail(400, "Phone context is invalid")
                        return
                    room.context = {k: context.get(k, "" if k in ("screen", "title", "selection") else False) for k in ("screen", "title", "selection", "canRead", "canBook", "canBack")}
                self.send_state(room, now)
                return
            if path == "/api/phone/mission":
                if not token_matches(body.get("hostToken"), room.host_token):
                    self.fail(403, "Host pairing is not valid")
                    return
                revision = body.get("revision")
                mission = body.get("mission")
                if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
                    self.fail(400, "Mission revision is invalid")
                    return
                if mission is not None and (not isinstance(mission, dict) or mission.get("id") not in TASK_IDS
                    or not isinstance(mission.get("runId"), str) or not 1 <= len(mission["runId"]) <= 100
                    or mission.get("world") not in ("moon", "mars") or not isinstance(mission.get("paused"), bool)):
                    self.fail(400, "Mission assignment is invalid")
                    return
                if revision > room.mission_revision:
                    if mission is None or room.mission is None or mission["runId"] != room.mission["runId"]:
                        room.mission_result = None
                    room.mission = None if mission is None else {key: mission[key] for key in ("id", "runId", "world", "paused")}
                    room.mission_revision = revision
                    room.neutral()
                room.touched = room.host_seen = now
                self.send_json(200, {"ok": True, "revision": room.mission_revision})
                return
            if path == "/api/phone/join":
                if room.live(now):
                    self.fail(409, "A phone is already connected")
                    return
                room.neutral()
                room.task_ready = False
                room.input_sequence = -1
                room.controller_token = secrets.token_urlsafe(32)
                room.last_input = now
                room.touched = now
                self.send_json(200, {"controllerToken": room.controller_token})
                return
            token = body.get("controllerToken")
            if not token_matches(token, room.controller_token):
                self.fail(403, "Phone pairing is no longer valid")
                return
            values = []
            for key, low, high in (("steer", -1, 1), ("gas", 0, 1), ("brake", 0, 1)):
                value = body.get(key)
                if isinstance(value, bool) or not isinstance(value, (int, float)) or (isinstance(value, float) and not math.isfinite(value)):
                    self.fail(400, "Steer, gas and brake must be finite numbers")
                    return
                values.append(max(low, min(high, value)))
            buttons = body.get("buttons")
            if not isinstance(buttons, dict) or any(key not in BUTTONS or not isinstance(value, bool) for key, value in buttons.items()):
                self.fail(400, "Buttons must contain supported button names and booleans")
                return
            sequence = body.get("sequence")
            if sequence is None and room.input_sequence >= 0:
                self.send_json(200, {"ok": True, "mission": room.mission, "context": room.context, "missionAck": None})
                return
            if sequence is not None:
                if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0:
                    self.fail(400, "Input sequence is invalid")
                    return
                if sequence <= room.input_sequence:
                    self.send_json(200, {"ok": True, "mission": room.mission, "context": room.context, "missionAck": None})
                    return
                room.input_sequence = sequence
            # A long gap is an input discontinuity, even if this phone retains its token.
            if not room.live(now):
                room.neutral()
            down = {key: buttons.get(key, False) for key in BUTTONS}
            for key in BUTTONS:
                if down[key] and not room.down[key]:
                    room.edges.append(key)
            room.steer, room.gas, room.brake = values
            room.down = down
            room.last_input = room.touched = now
            # A neutral release beacon is not a capabilities update. Preserve
            # readiness when omitted by an older in-flight beacon.
            if "taskReady" in body:
                room.task_ready = body["taskReady"] is True
            result = body.get("missionResult")
            acknowledged = None
            if isinstance(result, dict) and isinstance(result.get("runId"), str) and isinstance(result.get("ok"), bool):
                # A previous run can never finish the current assignment. ACK stale
                # results too, so a delayed client stops retrying a superseded run.
                acknowledged = result["runId"]
                if room.mission and result["runId"] == room.mission["runId"] and room.mission_result is None:
                    room.mission_result = {"runId": result["runId"], "ok": result["ok"]}
            self.send_json(200, {"ok": True, "mission": room.mission, "missionAck": acknowledged, "context": room.context})

    def do_GET(self):
        parts = urlsplit(self.path)
        if parts.path.startswith("/api/phone/"):
            self.api_get(parts)
        else:
            self.static(parts.path)

    def do_HEAD(self):
        parts = urlsplit(self.path)
        if parts.path.startswith("/api/"):
            self.fail(405, "Use GET")
        else:
            self.static(parts.path, head=True)

    def api_get(self, parts):
        if not self.same_origin():
            return
        if parts.path == "/api/phone/info":
            port = self.server.server_port
            host = self.headers["Host"]
            scheme = self.server.scheme
            addresses = local_ipv4() if self.server.server_address[0] in ("", "0.0.0.0") else []
            bases = [scheme + "://" + host] + [f"{scheme}://{address}:{port}" for address in addresses]
            urls = [self.server.public_url + "/phone.html"] if self.server.public_url else list(dict.fromkeys(base + "/phone.html" for base in bases))
            self.send_json(200, {"version": 1, "urls": urls})
            return
        if parts.path != "/api/phone/state":
            self.fail(404, "Not found")
            return
        code = parse_qs(parts.query).get("room", [""])[0]
        now = self.server.clock()
        with self.server.room_lock:
            self.server.expire(now)
            room = self.server.rooms.get(code)
            token = self.headers.get("X-Rover-Host", "")
            if room is None or not token_matches(token, room.host_token):
                self.fail(403, "Host pairing is not valid")
                return
            self.send_state(room, now)

    def send_state(self, room, now):
        connected = room.live(now)
        if not connected:
            room.neutral()
        room.touched = room.host_seen = now
        value = {"connected": connected, "steer": room.steer, "gas": room.gas,
                 "brake": room.brake, "down": room.down.copy(), "pressed": list(room.edges),
                 "taskReady": connected and room.task_ready, "missionResult": room.mission_result}
        room.edges.clear()
        self.send_json(200, value)

    def static(self, path, head=False):
        decoded = unquote(path)
        parts = decoded.split("/")
        if "\\" in decoded or "\x00" in decoded or any(part.startswith(".") for part in parts if part):
            self.fail(404, "Not found")
            return
        target = (self.server.root / decoded.lstrip("/")).resolve()
        if not target.is_relative_to(self.server.root) or any(part.startswith(".") for part in target.relative_to(self.server.root).parts):
            self.fail(404, "Not found")
            return
        if target.is_dir():
            target = (target / "index.html").resolve()
        if (not target.is_relative_to(self.server.root) or not target.is_file()
                or any(part.startswith(".") for part in target.relative_to(self.server.root).parts)):
            self.fail(404, "Not found")
            return
        relative = target.relative_to(self.server.root)
        if self.server.public_url and relative.parts[0] not in {"js", "lib", "index.html", "phone.html", "phone-missions.css", "phone-mission-practice.html", "moon.jpg", "mars.jpg", "favicon.ico"}:
            self.fail(404, "Not found")
            return
        try:
            data = target.read_bytes()
        except OSError:
            self.fail(404, "Not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if not head:
            self.wfile.write(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="0.0.0.0", help="Bind address (default: all local interfaces)")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--cert", type=Path, help="TLS certificate file trusted by the phone")
    parser.add_argument("--key", type=Path, help="Private key for --cert")
    parser.add_argument("--public-url", help="Exact HTTPS origin of an optional temporary test tunnel")
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key):
        parser.error("--cert and --key must be supplied together")
    public_url = None
    if args.public_url:
        try:
            public = urlsplit(args.public_url)
            valid = public.scheme == "https" and authority(public.netloc, 443) is not None and public.path in ("", "/") and not public.query and not public.fragment
        except ValueError:
            valid = False
        if not valid:
            parser.error("--public-url must be an HTTPS origin, e.g. https://example.trycloudflare.com")
        public_url = args.public_url.rstrip("/")
    tls = None
    if args.cert:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        try:
            tls.load_cert_chain(args.cert, args.key)
        except (OSError, ssl.SSLError) as error:
            parser.error("Cannot load TLS certificate/key: " + str(error))
    with RoverServer((args.host, args.port), public_url=public_url) as server:
        if tls:
            server.socket = tls.wrap_socket(server.socket, server_side=True)
            server.scheme = "https"
        print("Ghost Rovers phone experiment — stop the server when finished.", flush=True)
        if public_url:
            print(f"HTTPS test: {public_url}/", flush=True)
        addresses = ["127.0.0.1"] + local_ipv4() if args.host in ("", "0.0.0.0") else [args.host]
        for address in addresses:
            print(f"Game:  {server.scheme}://{address}:{server.server_port}/", flush=True)
            print(f"Phone: {server.scheme}://{address}:{server.server_port}/phone.html", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

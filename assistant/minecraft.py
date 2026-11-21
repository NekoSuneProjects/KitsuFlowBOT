"""Minecraft Interactive: run action commands on a Minecraft Java server over RCON.

Enable RCON in server.properties:
    enable-rcon=true
    rcon.port=25575
    rcon.password=<a long random password>
Keep the RCON port closed to the internet; the Assistant normally talks to 127.0.0.1.
"""
import re
import socket
import struct

PLAYER = re.compile(r"^[A-Za-z0-9_]{3,16}$")
# Never run server-admin commands, even if a job contains them (the server blocks them too).
BLOCKED = {"op", "deop", "stop", "ban", "ban-ip", "pardon", "pardon-ip", "whitelist", "kick",
           "save-off", "save-all", "reload", "restart", "debug", "perf", "jfr", "transfer"}
LOGIN, COMMAND, AUTH_RESPONSE = 3, 2, 2


class RconError(Exception):
    pass


class Rcon:
    """Minimal Source RCON client (the protocol Minecraft uses)."""

    def __init__(self, host, port, password, timeout=6):
        self.host, self.port, self.password, self.timeout = host, int(port), password, timeout
        self.sock = None
        self.next_id = 1

    def __enter__(self):
        try:
            self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        except OSError as exc:
            raise RconError(f"Cannot connect to RCON at {self.host}:{self.port} ({exc.strerror or exc})") from None
        request_id = self._send(LOGIN, self.password)
        # Source servers (ARK, Palworld…) send an empty RESPONSE_VALUE before the AUTH_RESPONSE;
        # Minecraft sends only the AUTH_RESPONSE. Skip type-0 packets until the auth answer.
        for _ in range(3):
            reply_id, kind, _ = self._read_packet()
            if kind == AUTH_RESPONSE:
                break
        else:
            raise RconError("RCON server did not answer the login")
        if reply_id == -1 or reply_id != request_id:
            raise RconError("RCON password rejected")
        return self

    def __exit__(self, *exc):
        if self.sock:
            self.sock.close()

    def _send(self, kind, body):
        request_id = self.next_id
        self.next_id += 1
        data = body.encode("utf-8") + b"\x00\x00"
        self.sock.sendall(struct.pack("<iii", len(data) + 8, request_id, kind) + data)
        return request_id

    def _recv(self, size):
        out = b""
        while len(out) < size:
            chunk = self.sock.recv(size - len(out))
            if not chunk:
                raise RconError("RCON connection closed")
            out += chunk
        return out

    def _read_packet(self):
        (length,) = struct.unpack("<i", self._recv(4))
        if not 10 <= length <= 4106:
            raise RconError("Invalid RCON response")
        payload = self._recv(length)
        request_id, kind = struct.unpack("<ii", payload[:8])
        return request_id, kind, payload[8:-2].decode("utf-8", "replace")

    def _read(self):
        request_id, _kind, body = self._read_packet()
        return request_id, body

    def command(self, text):
        request_id = self._send(COMMAND, text)
        reply_id, body = self._read()
        if reply_id != request_id:
            raise RconError("Unexpected RCON reply")
        return body


def check_command(line):
    word = line.split()[0].lower().removeprefix("minecraft:") if line.split() else ""
    if not word:
        raise RconError("Empty command")
    if word in BLOCKED:
        raise RconError(f'"{word}" is a server-admin command and is not allowed')


def run_action(payload, host, port, password, player):
    """Runs every command of a Minecraft job. Returns a short summary; raises RconError."""
    if "{player}" in " ".join(payload.get("commands", [])) and not PLAYER.match(player or ""):
        raise RconError("Set your Minecraft player name in the Assistant app (Minecraft tab)")
    commands = [str(c).replace("{player}", player or "").lstrip("/") for c in payload.get("commands", [])][:10]
    if not commands:
        raise RconError("Action has no commands")
    for line in commands:
        check_command(line)
    outputs = []
    with Rcon(host, port, password) as rcon:
        for line in commands:
            outputs.append(rcon.command(line).strip())
    errors = [o for o in outputs if re.search(r"^(Unknown|Incorrect|Expected|No entity|Invalid)", o, re.I)]
    if errors:
        raise RconError("Minecraft said: " + errors[0][:150])
    return f"Ran {len(commands)} command(s)" + (": " + outputs[-1][:120] if outputs[-1] else "")


def test_connection(host, port, password):
    with Rcon(host, port, password) as rcon:
        return rcon.command("list").strip() or "Connected"

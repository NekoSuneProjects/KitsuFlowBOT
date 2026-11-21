"""Small HTTPS client for the KitsuFlowBOT dashboard, authenticated with the paired device key."""
import json
import urllib.error
import urllib.request

from version import VERSION

USER_AGENT = "KitsuFlowBOT-Assistant/" + VERSION


class ApiError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class KitsuFlowApi:
    def __init__(self, server, device_key):
        server = str(server or "").strip().rstrip("/")
        if not server.startswith("https://") and not server.startswith("http://localhost:") \
                and not server.startswith("http://127.0.0.1:"):
            raise ApiError("Use an HTTPS dashboard URL.")
        if not str(device_key or "").startswith("kfv_"):
            raise ApiError("Enter the device key from Studio → Voice & Clips → Pair a PC.")
        self.server = server
        self.key = device_key

    def request(self, endpoint, payload=None, timeout=18):
        data = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(
            self.server + endpoint, data=data, method="POST" if data is not None else "GET",
            headers={"Authorization": "Bearer " + self.key, "Content-Type": "application/json",
                     "Accept": "application/json", "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            try:
                detail = json.load(exc).get("error", "")
            except Exception:
                detail = ""
            if exc.code == 401:
                detail = detail or "Device key rejected. Pair this PC again in Studio."
            raise ApiError(detail or ("HTTP " + str(exc.code)), exc.code) from None
        except urllib.error.URLError as exc:
            raise ApiError("Cannot reach " + self.server + ": " + str(exc.reason)) from None

    # Voice clips (existing companion endpoints)
    def voice_config(self):
        return self.request("/api/voice-companion/device/config")

    def voice_trigger(self, phrase):
        return self.request("/api/voice-companion/device/trigger", {"phrase": phrase})

    # Assistant jobs (Beat Saber, Minecraft)
    def assistant_config(self):
        return self.request("/api/assistant/device/config")

    def next_jobs(self):
        return self.request("/api/assistant/device/jobs").get("jobs", [])

    def report(self, job_id, ok, message):
        return self.request("/api/assistant/device/jobs/" + str(int(job_id)), {"ok": bool(ok), "message": str(message)[:300]})

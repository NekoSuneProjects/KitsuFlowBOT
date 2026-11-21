"""Beat Saber song requests (PC): install a BeatSaver map into Beat Saber_Data/CustomLevels.

Python port of the old Electron song-request client's PC mode, with safer downloads:
only https BeatSaver hosts, size limits, and zip extraction that rejects path traversal
and symlinks. Maps are staged in a temporary folder and moved into place when complete.
"""
import os
import re
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urlparse

from api import USER_AGENT

MAX_DOWNLOAD = 100 * 1024 * 1024
MAX_EXTRACTED = 300 * 1024 * 1024
KEY = re.compile(r"^[0-9a-f]{1,8}$")

# Default install folders (Steam and the Oculus/Meta PC app).
CANDIDATES = [
    r"C:\Program Files (x86)\Steam\steamapps\common\Beat Saber",
    r"C:\Program Files\Steam\steamapps\common\Beat Saber",
    r"D:\SteamLibrary\steamapps\common\Beat Saber",
    r"E:\SteamLibrary\steamapps\common\Beat Saber",
    r"C:\Program Files\Oculus\Software\Software\hyperbolic-magnetism-beat-saber",
    os.path.expanduser("~/.steam/steam/steamapps/common/Beat Saber"),
    os.path.expanduser("~/.local/share/Steam/steamapps/common/Beat Saber"),
]


class InstallError(Exception):
    pass


def is_game_folder(folder):
    return bool(folder) and (Path(folder) / "Beat Saber_Data").is_dir()


def detect_game_folder():
    return next((c for c in CANDIDATES if is_game_folder(c)), "")


def custom_levels(game_folder):
    if not is_game_folder(game_folder):
        raise InstallError("Beat Saber folder not set or not found (it must contain 'Beat Saber_Data')")
    folder = Path(game_folder) / "Beat Saber_Data" / "CustomLevels"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def folder_name(payload):
    """Same naming as BeatSaver / ModAssistant: "<key> (<song> - <mapper>)"."""
    raw = f"{payload['key']} ({payload.get('songName', '')} - {payload.get('mapper', '')})"
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", raw).strip().rstrip(". ")
    return safe[:120] or payload["key"]


def _download(url, target):
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not (host == "beatsaver.com" or host.endswith(".beatsaver.com")):
        raise InstallError("Refusing to download from " + (host or "an unknown host"))
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    size = 0
    with urllib.request.urlopen(request, timeout=60) as response, open(target, "wb") as out:
        if urlparse(response.geturl()).scheme != "https":
            raise InstallError("Download was redirected away from HTTPS")
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_DOWNLOAD:
                raise InstallError("Map download is larger than 100 MB")
            out.write(chunk)


def _safe_extract(archive, destination):
    with zipfile.ZipFile(archive) as zf:
        entries = zf.infolist()
        if sum(e.file_size for e in entries) > MAX_EXTRACTED:
            raise InstallError("Map is larger than 300 MB when extracted")
        root = destination.resolve()
        for entry in entries:
            name = entry.filename.replace("\\", "/")
            target = (destination / name).resolve()
            inside = target == root or str(target).startswith(str(root) + os.sep)
            if name.startswith("/") or ".." in name.split("/") or not inside:
                raise InstallError("Map archive contains an unsafe path")
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise InstallError("Map archive contains a symlink")
        zf.extractall(destination)
    if not any(p.name.lower() == "info.dat" for p in destination.iterdir()):
        raise InstallError("Downloaded file is not a Beat Saber map (no Info.dat)")


def install_map(payload, game_folder):
    """Returns a short status message; raises InstallError on failure."""
    key = str(payload.get("key", "")).lower()
    if not KEY.match(key):
        raise InstallError("Invalid BeatSaver key")
    levels = custom_levels(game_folder)
    target = levels / folder_name({**payload, "key": key})
    if target.exists() or any(p.name.split(" ")[0].lower() == key for p in levels.iterdir() if p.is_dir()):
        return "Already installed"
    work = Path(tempfile.mkdtemp(prefix="kitsuflow-bsr-"))
    try:
        archive = work / (key + ".zip")
        _download(str(payload.get("downloadURL", "")), archive)
        staged = work / "map"
        staged.mkdir()
        try:
            _safe_extract(archive, staged)
        except zipfile.BadZipFile:
            raise InstallError("Downloaded file is not a valid zip") from None
        shutil.move(str(staged), str(target))
        return "Installed into CustomLevels"
    finally:
        shutil.rmtree(work, ignore_errors=True)

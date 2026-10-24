"""Secure, resumable high-accuracy Vosk model installation for the desktop GUI."""
import os
from pathlib import Path
import shutil
import urllib.request
import zipfile

MODEL_NAME = "vosk-model-en-us-0.22"
MODEL_URL = "https://alphacephei.com/vosk/models/" + MODEL_NAME + ".zip"
# Official full-size English model (about 1.8 GB compressed). Never silently choose a small model.
MAX_ARCHIVE_BYTES = 3 * 1024**3
MAX_EXTRACT_BYTES = 12 * 1024**3

def valid_model(folder):
    folder = Path(folder)
    return folder.is_dir() and (folder / "am" / "final.mdl").is_file() and (folder / "conf" / "model.conf").is_file()

def install_model(destination, progress=lambda percent, message: None, cancel=None):
    def check_cancel():
        if cancel is not None and cancel.is_set():
            raise InterruptedError('Vosk model download cancelled')
    check_cancel()
    destination = Path(destination).expanduser().resolve()
    if valid_model(destination):
        progress(100, "Full-quality model already installed")
        return destination
    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    archive = parent / (MODEL_NAME + ".zip.part")
    staged = parent / (destination.name + ".extracting")
    downloaded = archive.stat().st_size if archive.exists() else 0
    if downloaded > MAX_ARCHIVE_BYTES:
        raise RuntimeError("Partial download is unexpectedly large; remove " + str(archive))
    headers = {"User-Agent": "KitsuFlowVoiceCompanion/1.0"}
    if downloaded:
        headers["Range"] = "bytes=" + str(downloaded) + "-"
    request = urllib.request.Request(MODEL_URL, headers=headers)
    progress(0, "Downloading full Vosk English model (~1.8 GB)…")
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.geturl().split(":", 1)[0] != "https":
            raise RuntimeError("Refusing non-HTTPS model download")
        if downloaded and response.status != 206:
            downloaded = 0
        total = response.headers.get("Content-Length")
        total = int(total) + downloaded if total and total.isdigit() else 0
        if total > MAX_ARCHIVE_BYTES:
            raise RuntimeError("Model archive exceeds configured size limit")
        mode = "ab" if downloaded else "wb"
        with archive.open(mode) as output:
            while True:
                check_cancel()
                chunk = response.read(1024 * 1024)
                if not chunk: break
                downloaded += len(chunk)
                if downloaded > MAX_ARCHIVE_BYTES:
                    raise RuntimeError("Model archive exceeds configured size limit")
                output.write(chunk)
                progress(min(90, int(90 * downloaded / total)) if total else 0,
                         "Downloading high-accuracy model: " + str(round(downloaded / 1024**2)) +
                         (" / " + str(round(total / 1024**2)) if total else "") + " MiB")
    progress(91, "Validating downloaded archive…")
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        total_size = sum(i.file_size for i in entries)
        if total_size > MAX_EXTRACT_BYTES:
            raise RuntimeError("Model extracted size exceeds safety limit")
        root = MODEL_NAME + "/"
        for entry in entries:
            name = entry.filename.replace("\\", "/")
            if not name.startswith(root) or ".." in name.split("/") or name.startswith("/"):
                raise RuntimeError("Unexpected file path inside speech model archive")
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise RuntimeError("Symlinks are not allowed in speech model")
        if staged.exists(): shutil.rmtree(staged)
        staged.mkdir()
        for index, entry in enumerate(entries):
            check_cancel()
            relative = entry.filename[len(root):]
            if not relative: continue
            output = staged / relative
            if entry.is_dir():
                output.mkdir(parents=True, exist_ok=True)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                with z.open(entry) as source, output.open("wb") as target:
                    while True:
                        check_cancel()
                        block = source.read(1024 * 1024)
                        if not block: break
                        target.write(block)
            if index % 100 == 0:
                progress(91 + int(8 * index / max(len(entries), 1)), "Extracting full-quality speech model…")
    if not valid_model(staged):
        shutil.rmtree(staged, ignore_errors=True)
        raise RuntimeError("Downloaded model did not contain expected Vosk files")
    if destination.exists():
        raise RuntimeError("Model directory exists but is invalid: " + str(destination))
    os.replace(staged, destination)
    archive.unlink(missing_ok=True)
    progress(100, "High-accuracy Vosk model installed")
    return destination

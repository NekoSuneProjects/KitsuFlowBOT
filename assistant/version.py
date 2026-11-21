"""App version: the VERSION file shipped next to the executable by the release workflow."""
import sys
from pathlib import Path

_root = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
try:
    VERSION = (_root / "VERSION").read_text(encoding="utf-8").strip() or "dev"
except OSError:
    VERSION = "dev"

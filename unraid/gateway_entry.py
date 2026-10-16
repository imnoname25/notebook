"""Isolated Python launcher: import only the administrator-installed sibling modules."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import runpy

sys.argv = [str(Path(__file__).with_name("gateway.py")), "ssh"]
runpy.run_module("gateway", run_name="__main__")

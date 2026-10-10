"""Resolve resources from the independent plugin bundle."""
import sys
import os
from pathlib import Path

def agent_cli_path():
    root = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1]))
    path = root / 'agent_runtime' / ('claude.exe' if os.name == 'nt' else 'claude')
    if path.is_file():
        return path
    import claude_agent_sdk
    return Path(claude_agent_sdk.__file__).parent / '_bundled' / ('claude.exe' if os.name == 'nt' else 'claude')

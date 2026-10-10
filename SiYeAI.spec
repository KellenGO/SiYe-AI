from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules
ROOT = Path(SPECPATH)
datas = [(str(ROOT / "agent_runtime"), "agent_runtime")]
binaries = []
hiddenimports = collect_submodules("siye_ai")
for package in ("claude_agent_sdk", "mcp", "parsel"):
    d, b, h = collect_all(package, filter_submodules=lambda name: not name.startswith("mcp.cli"))
    datas.extend((p, dest) for p, dest in d if "_bundled" not in p)
    binaries.extend((p, dest) for p, dest in b if "_bundled" not in p)
    hiddenimports.extend(h)
a = Analysis([str(ROOT / "worker_main.py")], pathex=[str(ROOT)], datas=datas, binaries=binaries, hiddenimports=hiddenimports,
             excludes=["tkinter", "cv2", "playwright", "faster_whisper", "api", "media_platform", "aggregate_search"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="SiYeAI", console=True, upx=False)
collection = COLLECT(exe, a.binaries, a.datas, name="SiYeAI", upx=False)

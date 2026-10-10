"""Build a self-contained Windows AI extension ZIP and SHA256."""
import hashlib
import json
import os
import tomllib
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
def run(*args, cwd=ROOT):
    subprocess.run(args, cwd=cwd, check=True)
def main():
    manifest=json.loads((ROOT / "extension.json").read_text(encoding="utf-8"))
    project=tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    ui=json.loads((ROOT / "webui/package.json").read_text(encoding="utf-8"))
    if not manifest["version"] == project["project"]["version"] == ui["version"]:
        raise ValueError("Plugin version declarations do not match")
    if os.environ.get("GITHUB_REF_TYPE") == "tag" and os.environ.get("GITHUB_REF_NAME", "").removeprefix("v") != manifest["version"]:
        raise ValueError("Release tag does not match plugin version")
    run(sys.executable, "scripts/prepare_agent_runtime.py")
    run("npm.cmd", "run", "build", cwd=ROOT / "webui")
    run(sys.executable, "-m", "PyInstaller", "--noconfirm", "--distpath", "build/frozen", "--workpath", "build/pyinstaller", "SiYeAI.spec")
    package=ROOT / "build/frozen/SiYeAI"
    (package / "assets").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "webui/dist/ui.js", package / "assets/ui.js")
    for name in ("extension.json", "LICENSE"):
        shutil.copy2(ROOT / name, package / name)
    target=ROOT / "dist/SiYe-AI-Windows-x64.zip"
    target.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(target,"w",zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(package.rglob("*")):
            if path.is_file():
                bundle.write(path,path.relative_to(package).as_posix())
    with target.open("rb") as source:
        digest=hashlib.file_digest(source,"sha256").hexdigest()
    target.with_suffix(".zip.sha256").write_text(digest + "  " + target.name + "\n", encoding="ascii")
    release = {"tag_name": "v" + manifest["version"], "assets": [{
        "name": target.name, "size": target.stat().st_size, "digest": "sha256:" + digest,
        "browser_download_url": "https://github.com/KellenGO/SiYe-AI/releases/download/v" + manifest["version"] + "/" + target.name
    }]}
    (target.parent / "extension-release.json").write_text(json.dumps(release, indent=2), encoding="utf-8")
    print(target)
if __name__ == "__main__":
    main()

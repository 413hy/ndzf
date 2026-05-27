import hashlib
import json
import shutil
import sqlite3
import sys
from pathlib import Path


def fingerprint(path: Path) -> str | None:
    try:
        conn = sqlite3.connect(path)
        try:
            row = conn.execute("select dc_id, server_address, port, auth_key from sessions limit 1").fetchone()
        finally:
            conn.close()
        if not row:
            return None
        dc_id, server, port, auth_key = row
        data = f"{dc_id}|{server}|{port}|".encode("utf-8") + bytes(auth_key or b"")
        return hashlib.sha256(data).hexdigest()
    except Exception:
        return None


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return {}


def main() -> int:
    app_dir = Path(__file__).resolve().parents[1]
    sessions_dir = app_dir / "sessions"
    sessions_dir.mkdir(exist_ok=True)
    config_path = app_dir / "session_config.json"

    if len(sys.argv) >= 2:
        src_dir = Path(sys.argv[1]).expanduser()
    else:
        src_dir = Path(input("Input converted_sessions folder path: ").strip().strip('"')).expanduser()

    if not src_dir.exists() or not src_dir.is_dir():
        print(f"Folder not found: {src_dir}")
        return 1

    app_config = load_json(config_path)
    src_config = load_json(src_dir / "session_config.json")

    existing = {}
    for session_file in sessions_dir.glob("*.session"):
        fp = fingerprint(session_file)
        if fp:
            existing[fp] = session_file.stem

    imported = []
    skipped = []
    failed = []

    for session_file in sorted(src_dir.glob("*.session")):
        name = session_file.stem
        fp = fingerprint(session_file)
        if not fp:
            failed.append({"name": name, "error": "invalid session sqlite"})
            continue
        if fp in existing:
            skipped.append({"name": name, "same_as": existing[fp]})
            continue

        dest_session = sessions_dir / session_file.name
        dest_json = sessions_dir / f"{name}.json"

        if dest_session.exists():
            failed.append({"name": name, "error": f"target exists: {dest_session.name}"})
            continue

        shutil.copy2(session_file, dest_session)
        src_json = src_dir / f"{name}.json"
        if src_json.exists():
            shutil.copy2(src_json, dest_json)

        if name in src_config:
            app_config[name] = src_config[name]
        elif src_json.exists():
            item = load_json(src_json)
            app_config[name] = {
                "api_id": item.get("api_id"),
                "api_hash": item.get("api_hash"),
                "device": item.get("device_model"),
                "system": item.get("system_version"),
                "app": item.get("app_version"),
                "lang_code": item.get("lang_code", "en"),
                "system_lang_code": item.get("system_lang_code", "en-US"),
            }

        existing[fp] = name
        imported.append(name)

    config_path.write_text(json.dumps(app_config, ensure_ascii=False, indent=2), encoding="utf-8")

    result = {"imported": imported, "skipped_duplicates": skipped, "failed": failed}
    (src_dir / "import_to_app_result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Imported: {len(imported)}")
    print(f"Skipped duplicates: {len(skipped)}")
    print(f"Failed: {len(failed)}")
    print(f"Result: {src_dir / 'import_to_app_result.json'}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())

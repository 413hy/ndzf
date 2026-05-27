import hashlib
import json
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path


def session_fingerprint(path: Path) -> str | None:
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


def main() -> int:
    app_dir = Path(__file__).resolve().parents[1]
    sessions_dir = app_dir / "sessions"
    config_path = app_dir / "session_config.json"

    if not sessions_dir.exists():
        print(f"sessions folder not found: {sessions_dir}")
        return 1

    backup_dir = app_dir / "backup_duplicate_sessions" / datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir.mkdir(parents=True, exist_ok=False)

    config = {}
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8-sig"))
        except Exception:
            config = {}

    seen = {}
    removed = []
    kept = []

    for session_file in sorted(sessions_dir.glob("*.session")):
        name = session_file.stem
        fp = session_fingerprint(session_file)
        if not fp:
            kept.append({"name": name, "reason": "no fingerprint"})
            continue

        if fp not in seen:
            seen[fp] = name
            kept.append({"name": name, "reason": "first"})
            continue

        backup_session = backup_dir / session_file.name
        shutil.move(str(session_file), str(backup_session))

        json_file = sessions_dir / f"{name}.json"
        if json_file.exists():
            shutil.move(str(json_file), str(backup_dir / json_file.name))

        config.pop(name, None)
        removed.append({"name": name, "same_as": seen[fp], "backup": str(backup_session)})

    if config_path.exists():
        shutil.copy2(config_path, backup_dir / "session_config.json.before_cleanup")
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    result = {
        "kept": kept,
        "removed": removed,
        "backup_dir": str(backup_dir),
    }
    (backup_dir / "cleanup_result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Done. Removed duplicates: {len(removed)}")
    print(f"Backup: {backup_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

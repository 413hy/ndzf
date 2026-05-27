import hashlib
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from telethon.sessions import SQLiteSession, StringSession


DEFAULT_API_ID = 2040
DEFAULT_API_HASH = "b18441a1ff607e10a989891a5462e627"


def read_fields(path: Path) -> dict:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    fields = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, value = line.split("=", 1)
        elif ":" in line:
            key, value = line.split(":", 1)
        else:
            continue
        fields[key.strip()] = value.strip()
    return fields


def read_account_blocks(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    accounts = []
    current = {}

    def flush_current() -> None:
        nonlocal current
        if current:
            accounts.append(current)
            current = {}

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower() == "[account]":
            flush_current()
            continue
        if "=" in line:
            key, value = line.split("=", 1)
        elif ":" in line:
            key, value = line.split(":", 1)
        else:
            continue
        current[key.strip()] = value.strip()

    flush_current()
    return [account for account in accounts if account.get("string_session")]


def load_api_from_config(app_dir: Path) -> tuple[int, str]:
    config_path = app_dir / "config.json"
    if not config_path.exists():
        return DEFAULT_API_ID, DEFAULT_API_HASH

    try:
        cfg = json.loads(config_path.read_text(encoding="utf-8-sig"))
        first_api = (cfg.get("api_pool") or [{}])[0]
        api_id = int(first_api.get("api_id") or DEFAULT_API_ID)
        api_hash = first_api.get("api_hash") or DEFAULT_API_HASH
        return api_id, api_hash
    except Exception:
        return DEFAULT_API_ID, DEFAULT_API_HASH


def collect_sources(raw_args: list[str]) -> list[Path]:
    sources = []
    for raw in raw_args:
        text = raw.strip().strip('"')
        if not text:
            continue
        path = Path(text).expanduser()
        if path.is_dir():
            sources.extend(sorted(path.glob("tg_session*.txt")))
            sources.extend(sorted(p for p in path.glob("*.txt") if p not in sources))
        elif path.is_file():
            sources.append(path)

    unique = []
    seen = set()
    for src in sources:
        resolved = src.resolve()
        if resolved not in seen:
            unique.append(src)
            seen.add(resolved)
    return unique


def collect_jobs(sources: list[Path]) -> list[tuple[Path, dict]]:
    jobs = []
    for src in sources:
        blocks = read_account_blocks(src)
        if blocks:
            jobs.extend((src, block) for block in blocks)
            continue

        fields = read_fields(src)
        if fields.get("string_session"):
            jobs.append((src, fields))
    return jobs


def build_companion(api_id: int, api_hash: str) -> dict:
    return {
        "api_id": api_id,
        "api_hash": api_hash,
        "device_model": "Telegram Desktop",
        "system_version": "Windows 11 x64",
        "app_version": "5.8.3 x64",
        "lang_pack": "",
        "lang_code": "en",
        "system_lang_code": "en-US",
    }


def safe_account_name(fields: dict, fallback_index: int) -> str:
    user_id = (fields.get("telegram_user_id") or "").strip()
    if user_id.isdigit():
        return f"tg_{user_id}"

    phone = "".join(ch for ch in (fields.get("phone") or "") if ch.isdigit())
    if phone:
        return f"tg_phone_{phone}"

    return f"account_{fallback_index:02d}"


def convert_one(src: Path, fields: dict, out_dir: Path, account_name: str, companion: dict) -> dict:
    session_string = fields.get("string_session")
    if not session_string:
        raise RuntimeError("missing string_session")

    string_session = StringSession(session_string)
    sqlite_session = SQLiteSession(str(out_dir / account_name))
    sqlite_session.set_dc(string_session.dc_id, string_session.server_address, string_session.port)
    sqlite_session.auth_key = string_session.auth_key
    sqlite_session.save()
    sqlite_session.close()

    session_file = out_dir / f"{account_name}.session"
    conn = sqlite3.connect(session_file)
    try:
        conn.execute("select name from sqlite_master where type='table'").fetchall()
    finally:
        conn.close()

    (out_dir / f"{account_name}.json").write_text(
        json.dumps(companion, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return {
        "account_name": account_name,
        "source_file": str(src),
        "session_file": str(session_file),
        "json_file": str(out_dir / f"{account_name}.json"),
        "phone_masked": fields.get("phone_masked", ""),
        "username": fields.get("username", ""),
    }


def write_readme(out_dir: Path, count: int) -> None:
    readme = f"""批量转换完成：{count} 个账号

导入的方法：

1. 把本目录里的 account_XX.session 和同名 account_XX.json 发。
2. 打开软件，点击“导入 Session”。
3. 可以一次选择多个 .session 文件导入。
4. 同名 .json 最好和 .session 放在同一个文件夹里，软件会读取里面的 API 和设备配置。
5. 导入后点击“检测账号”。

如果检测失败，优先检查：

1. 软件是否已经导入 API 池。
2. .session 是否已经被 Telegram 踢下线或失效。
3. .json 是否和 .session 放在同一个文件夹里。

安全提醒：

.session 文件等同于 Telegram 登录凭证。谁拿到这些文件，谁就可能登录这些账号。
建议用加密压缩包发送，密码单独发。离职或不再使用时，可以在 Telegram 的设备管理里踢掉对应登录。
"""
    (out_dir / "使用说明.txt").write_text(readme, encoding="utf-8")


def main() -> int:
    app_dir = Path(__file__).resolve().parents[1]

    raw_args = sys.argv[1:]
    if not raw_args:
        user_input = input("Input one txt file path, multiple txt paths, or a folder path: ").strip()
        raw_args = [user_input]

    sources = collect_sources(raw_args)
    if not sources:
        print("No input txt files found.")
        return 1

    jobs = collect_jobs(sources)
    if not jobs:
        print("No string_session found in input files.")
        return 1

    api_id, api_hash = load_api_from_config(app_dir)
    companion = build_companion(api_id, api_hash)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = app_dir.parent / f"converted_sessions_{stamp}"
    out_dir.mkdir(parents=True, exist_ok=False)

    session_config = {}
    results = []
    errors = []

    seen_keys = set()
    deduped_jobs = []
    duplicate_count = 0
    for src, fields in jobs:
        session_string = fields.get("string_session", "")
        dedupe_key = fields.get("telegram_user_id") or hashlib.sha256(session_string.encode("utf-8")).hexdigest()
        if dedupe_key in seen_keys:
            duplicate_count += 1
            errors.append({"source_file": str(src), "error": f"duplicate skipped: {dedupe_key}"})
            continue
        seen_keys.add(dedupe_key)
        deduped_jobs.append((src, fields))

    for index, (src, fields) in enumerate(deduped_jobs, start=1):
        account_name = safe_account_name(fields, index)
        try:
            result = convert_one(src, fields, out_dir, account_name, companion)
            results.append(result)
            session_config[account_name] = {
                "api_id": companion["api_id"],
                "api_hash": companion["api_hash"],
                "device": companion["device_model"],
                "system": companion["system_version"],
                "app": companion["app_version"],
                "lang_code": companion["lang_code"],
                "system_lang_code": companion["system_lang_code"],
            }
            print(f"OK {account_name}: {src.name}")
        except Exception as exc:
            errors.append({"source_file": str(src), "error": str(exc)})
            print(f"FAIL {src.name}: {exc}")

    (out_dir / "session_config.json").write_text(
        json.dumps(session_config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (out_dir / "convert_result.json").write_text(
        json.dumps({"converted": results, "errors": errors}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_readme(out_dir, len(results))

    print("")
    print(f"Done. Converted: {len(results)}, Failed: {len(errors)}, Duplicates skipped: {duplicate_count}")
    print(f"Output: {out_dir}")
    return 0 if results else 1


if __name__ == "__main__":
    raise SystemExit(main())

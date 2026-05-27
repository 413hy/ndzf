import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import socks
from telethon import TelegramClient
from telethon.errors import (
    AuthKeyDuplicatedError,
    AuthKeyUnregisteredError,
    FloodWaitError,
    InviteHashExpiredError,
    InviteHashInvalidError,
    RPCError,
    UserAlreadyParticipantError,
    UserBannedInChannelError,
    UserDeactivatedBanError,
)
from telethon.tl.functions.messages import CheckChatInviteRequest, ImportChatInviteRequest


def get_system_proxy() -> tuple | None:
    proxy_server = os.environ.get("FDZN_PROXY", "").strip()
    if not proxy_server:
        proxy_server = "127.0.0.1:10808"
    if "://" in proxy_server:
        proxy_server = proxy_server.split("://", 1)[1]
    host, _, port = proxy_server.partition(":")
    if not host or not port:
        return None
    return (socks.SOCKS5, host, int(port), True)


async def with_timeout(coro, seconds):
    return await asyncio.wait_for(coro, timeout=seconds)


async def join_one(base: Path, link: str, name: str, meta: dict, proxy) -> dict:
    invite_hash = link.rsplit("+", 1)[-1].strip() if "+" in link else link.rsplit("/", 1)[-1].strip()
    row = {"session": name, "status": "", "detail": ""}
    client = TelegramClient(
        str(base / name),
        int(meta["api_id"]),
        meta["api_hash"],
        proxy=proxy,
        device_model=meta.get("device") or None,
        system_version=meta.get("system") or None,
        app_version=meta.get("app") or None,
        lang_code=meta.get("lang_code") or "en",
        system_lang_code=meta.get("system_lang_code") or "en-US",
        connection_retries=1,
        retry_delay=1,
        request_retries=1,
        timeout=10,
    )
    try:
        await with_timeout(client.connect(), 20)
        if not await with_timeout(client.is_user_authorized(), 15):
            row["status"] = "not_authorized"
            return row
        me = await with_timeout(client.get_me(), 15)
        row["user_id"] = me.id
        row["username"] = me.username or ""

        try:
            checked = await with_timeout(client(CheckChatInviteRequest(invite_hash)), 20)
            row["invite_check"] = type(checked).__name__
            row["group_title"] = getattr(checked, "title", None) or getattr(getattr(checked, "chat", None), "title", None) or ""
        except UserAlreadyParticipantError:
            row["status"] = "already_in_group"
            return row
        except Exception as exc:
            row["invite_check_error"] = f"{type(exc).__name__}: {exc}"

        try:
            await with_timeout(client(ImportChatInviteRequest(invite_hash)), 25)
            row["status"] = "joined"
            return row
        except UserAlreadyParticipantError:
            row["status"] = "already_in_group"
            return row
        except FloodWaitError as exc:
            row["status"] = "flood_wait"
            row["detail"] = f"{exc.seconds}s"
            return row
        except (InviteHashExpiredError, InviteHashInvalidError) as exc:
            row["status"] = "invite_invalid_or_expired"
            row["detail"] = type(exc).__name__
            return row
        except UserBannedInChannelError as exc:
            row["status"] = "banned_in_channel"
            row["detail"] = type(exc).__name__
            return row
        except RPCError as exc:
            row["status"] = "rpc_error"
            row["detail"] = f"{type(exc).__name__}: {exc}"
            return row
    except asyncio.TimeoutError:
        row["status"] = "timeout"
        return row
    except (AuthKeyUnregisteredError, AuthKeyDuplicatedError, UserDeactivatedBanError) as exc:
        row["status"] = "session_invalid"
        row["detail"] = type(exc).__name__
        return row
    except Exception as exc:
        row["status"] = "failed"
        row["detail"] = f"{type(exc).__name__}: {exc}"
        return row
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass


async def main_async(base: Path, link: str) -> tuple[list[dict], dict]:
    cfg = json.loads((base / "session_config.json").read_text(encoding="utf-8-sig"))
    proxy = get_system_proxy()
    results = []
    for idx, (name, meta) in enumerate(sorted(cfg.items()), 1):
        print(f"[{idx}/{len(cfg)}] {name}", flush=True)
        row = await join_one(base, link, name, meta, proxy)
        results.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        await asyncio.sleep(2)

    summary = {}
    for row in results:
        summary[row["status"]] = summary.get(row["status"], 0) + 1
    return results, summary


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: py join_group_sessions.py <converted_session_dir> <invite_link>")
        return 1
    base = Path(sys.argv[1]).expanduser()
    link = sys.argv[2].strip()
    if not (base / "session_config.json").exists():
        print(f"session_config.json not found: {base}")
        return 1

    results, summary = asyncio.run(main_async(base, link))
    out = base / f"join_group_result_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    out.write_text(json.dumps({"link": link, "summary": summary, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print("SUMMARY", json.dumps(summary, ensure_ascii=False))
    print("RESULT_FILE", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

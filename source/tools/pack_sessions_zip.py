import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path


def find_accounts(src_dir):
    accounts = []
    for session_file in sorted(src_dir.glob("*.session")):
        name = session_file.stem
        json_file = src_dir / f"{name}.json"
        if not json_file.exists():
            print(f"SKIP {name}: missing {name}.json")
            continue
        twofa = src_dir / f"{name}.2fa.txt"
        if not twofa.exists():
            twofa = src_dir / "2fa.txt" if (src_dir / "2fa.txt").exists() else None
        accounts.append((name, session_file, json_file, twofa))
    return accounts


def build_zip(src_dir, out_zip):
    accounts = find_accounts(src_dir)
    if not accounts:
        raise RuntimeError("No valid .session + .json account pairs found.")

    staging = src_dir.parent / f"{src_dir.name}_zip_staging_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    staging.mkdir(parents=True, exist_ok=False)
    try:
        for name, session_file, json_file, twofa in accounts:
            account_dir = staging / name
            account_dir.mkdir()
            shutil.copy2(session_file, account_dir / session_file.name)
            shutil.copy2(json_file, account_dir / json_file.name)
            if twofa and twofa.exists():
                shutil.copy2(twofa, account_dir / "2fa.txt")

        if out_zip.exists():
            out_zip.unlink()
        with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for file in sorted(staging.rglob("*")):
                if file.is_file():
                    zf.write(file, file.relative_to(staging))
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    print(f"Packed accounts: {len(accounts)}")
    print(f"Output zip: {out_zip}")
    return out_zip


def main():
    if len(sys.argv) >= 2:
        src_dir = Path(sys.argv[1]).expanduser()
    else:
        src_dir = Path(input("Input converted session directory: ").strip().strip('"')).expanduser()

    if not src_dir.exists() or not src_dir.is_dir():
        print(f"Directory does not exist: {src_dir}")
        return 1

    if len(sys.argv) >= 3:
        out_zip = Path(sys.argv[2]).expanduser()
    else:
        out_zip = src_dir.parent / f"{src_dir.name}_import.zip"

    try:
        build_zip(src_dir, out_zip)
    except Exception as exc:
        print(f"Pack failed: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

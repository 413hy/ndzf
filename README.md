# Fzdn1 TG Tool v4.1

This repository stores the emergency-maintained package sources and public installer for Fzdn1 TG Tool v4.1.

## Download

Use the installer in:

```text
release/Fzdn1_TG_Tool_v4.1_Public_Setup.exe
```

The installer supports choosing an install directory. After installation, run:

```text
Fzdn1_TG_Tool_v4.1.exe
```

Do not run `Fzdn1_TG_Tool_v4.1.real.exe` directly. It is the internal application binary and bypasses the launcher.

## Package Notes

- This public package does not include Telegram account sessions.
- This public package does not include `license.dat`.
- This public package does not include the internal API pool.
- Each employee should activate on their own machine and import their own accounts.
- Account list refresh now automatically removes duplicate imported accounts when the same Telegram user is detected.
- The group verification page treats "already in group" as a non-failure state in the visible log/statistics.

## Repository Layout

```text
docs/                 User instructions and recovery notes
installer/            Inno Setup build script
release/              Git LFS tracked installer binary
source/ui/            Modified UI files
source/tools/         Session conversion, clean import, duplicate cleanup, and group join helper scripts
source/launcher/      Single-instance launcher source
source/config/        Public sanitized config templates
resource/             API pool resources for employees
```

## Upgrade Behavior

The Inno Setup installer is configured so upgrade installs do not overwrite user data:

- `license.dat`
- `sessions/`
- `config.json`
- `session_config.json`
- `session_string_cache.json`

## Build

Build with Inno Setup 6:

```powershell
ISCC.exe installer\Fzdn1_TG_Tool_v4.1_GitHub_Public.iss
```

The build source path in the `.iss` file is currently set for the emergency build machine. Adjust `SourceDir` before rebuilding on another machine.

## API Resources

API pool resources are stored in:

```text
resource/api_pool.txt
```

Employees can copy the content into the software API pool page after installation.

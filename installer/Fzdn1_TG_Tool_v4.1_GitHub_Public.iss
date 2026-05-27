#define MyAppName "Fzdn1 TG Tool"
#define MyAppVersion "4.1"
#define MyAppPublisher "Fzdn"
#define MyAppExeName "Fzdn1_TG_Tool_v4.1.exe"
#define SourceDir "D:\test\fdzn_codex\fdzn_github_release_source"

[Setup]
AppId={{D3C4DC68-AD4E-4D34-B5F4-F6B0B9D2A941}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Fzdn1TGTool
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableDirPage=no
OutputDir=D:\test\fdzn_codex
OutputBaseFilename=Fzdn1_TG_Tool_v4.1_Public_Setup
SetupIconFile={#SourceDir}\favicon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes
RestartApplications=no
UsePreviousAppDir=no
DirExistsWarning=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
; Program files. User-owned data files are excluded here and handled below.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "license.dat,config.json,session_config.json,session_string_cache.json,install_fdzn.ps1,runtime_logs\*,日志\*,sessions\*"

; First-install defaults only. Upgrades must not overwrite employee data.
Source: "{#SourceDir}\config.json"; DestDir: "{app}"; Flags: ignoreversion onlyifdoesntexist uninsneveruninstall
Source: "{#SourceDir}\session_config.json"; DestDir: "{app}"; Flags: ignoreversion onlyifdoesntexist uninsneveruninstall
Source: "{#SourceDir}\session_string_cache.json"; DestDir: "{app}"; Flags: ignoreversion onlyifdoesntexist uninsneveruninstall

[Dirs]
Name: "{app}\sessions"; Flags: uninsneveruninstall
Name: "{app}\runtime_logs"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent; WorkingDir: "{app}"

[UninstallDelete]
; Keep user account data by default. Remove only runtime logs on uninstall.
Type: filesandordirs; Name: "{app}\runtime_logs"


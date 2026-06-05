using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class FzdnSingleInstanceLauncher
{
    private const string MutexName = "Global\\Fzdn1_TG_Tool_v4_1_SingleInstance";
    private const string RealExeName = "Fzdn1_TG_Tool_v4.1.real.exe";
    private const int PreferredLicensePort = 19803;
    private const string LicenseJson = "{\"ok\":true,\"message\":\"OK\",\"expire_ts\":7258118399,\"expire\":\"2199-12-31\"}";
    private static string _logDir = "";
    private static string _appRoot = "";
    private static int _licensePort = PreferredLicensePort;

    [STAThread]
    private static int Main(string[] args)
    {
        bool createdNew;
        using (var mutex = new Mutex(true, MutexName, out createdNew))
        {
            if (!createdNew || IsRealAppRunning())
            {
                if (Environment.GetEnvironmentVariable("FZDN_LAUNCHER_TEST_SILENT") == "1") return 9;
                MessageBox.Show("\u7a0b\u5e8f\u6b63\u5728\u8fd0\u884c\u4e2d\uff0c\u8bf7\u52ff\u91cd\u590d\u542f\u52a8\u3002", "\u63d0\u793a", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }

            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            _appRoot = root;
            _logDir = Path.Combine(root, "runtime_logs");

            CleanupOrphanSessions();
            StartEmbeddedLicenseProxy();

            string testHold = Environment.GetEnvironmentVariable("FZDN_LAUNCHER_TEST_HOLD");
            if (!string.IsNullOrEmpty(testHold))
            {
                int seconds;
                if (!int.TryParse(testHold, out seconds)) seconds = 5;
                Thread.Sleep(Math.Max(1, seconds) * 1000);
                return 0;
            }

            string realExe = Path.Combine(root, RealExeName);
            if (!File.Exists(realExe))
            {
                MessageBox.Show("\u672a\u627e\u5230\u5185\u90e8\u7a0b\u5e8f\u6587\u4ef6\uff1a" + RealExeName, "\u542f\u52a8\u5931\u8d25", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 2;
            }

            var psi = new ProcessStartInfo(realExe)
            {
                WorkingDirectory = root,
                UseShellExecute = false,
                Arguments = string.Join(" ", args.Select(QuoteArg).ToArray())
            };
            psi.EnvironmentVariables["HTTP_PROXY"] = "http://127.0.0.1:" + _licensePort;
            psi.EnvironmentVariables["http_proxy"] = "http://127.0.0.1:" + _licensePort;
            psi.EnvironmentVariables["NO_PROXY"] = "127.0.0.1,localhost";
            psi.EnvironmentVariables["no_proxy"] = "127.0.0.1,localhost";

            try
            {
                using (var child = Process.Start(psi))
                {
                    if (child == null) return 3;
                    child.WaitForExit();
                    return child.ExitCode;
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("\u542f\u52a8\u5931\u8d25\uff1a" + ex.Message, "\u542f\u52a8\u5931\u8d25", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 4;
            }
        }
    }

    private static bool IsRealAppRunning()
    {
        string processName = Path.GetFileNameWithoutExtension(RealExeName);
        return Process.GetProcessesByName(processName).Any(p =>
        {
            try { return !p.HasExited; }
            catch { return false; }
        });
    }

    private static void StartEmbeddedLicenseProxy()
    {
        TcpListener listener = null;
        for (int port = PreferredLicensePort; port <= PreferredLicensePort + 30; port++)
        {
            try
            {
                listener = new TcpListener(IPAddress.Parse("127.0.0.1"), port);
                listener.Start();
                _licensePort = port;
                break;
            }
            catch (Exception ex)
            {
                Log("Port " + port + " unavailable: " + ex.Message);
            }
        }

        if (listener == null)
        {
            Log("No available local license proxy port");
            return;
        }

        var thread = new Thread(() => LicenseProxyLoop(listener)) { IsBackground = true };
        thread.Start();
        Thread.Sleep(300);
    }

    private static void LicenseProxyLoop(TcpListener listener)
    {
        try
        {
            Log("Embedded license proxy listening on 127.0.0.1:" + _licensePort);
            while (true)
            {
                var client = listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(_ => HandleClient(client));
            }
        }
        catch (Exception ex)
        {
            Log("Proxy failed: " + ex.Message);
        }
    }

    private static void HandleClient(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.ReceiveTimeout = 5000;
                client.SendTimeout = 5000;
                NetworkStream stream = client.GetStream();
                byte[] buffer = new byte[65536];
                int total = 0;
                int headerEnd = -1;
                while (total < buffer.Length)
                {
                    int read = stream.Read(buffer, total, buffer.Length - total);
                    if (read <= 0) break;
                    total += read;
                    headerEnd = IndexOf(buffer, total, Encoding.ASCII.GetBytes("\r\n\r\n"));
                    if (headerEnd >= 0) break;
                }

                if (total <= 0) return;
                string header = Encoding.ASCII.GetString(buffer, 0, headerEnd >= 0 ? headerEnd : total);
                string firstLine = header.Split(new[] { "\r\n" }, StringSplitOptions.None)[0];
                string[] parts = firstLine.Split(' ');
                string path = parts.Length >= 2 ? parts[1] : "/";
                if (path.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                {
                    Uri uri;
                    if (Uri.TryCreate(path, UriKind.Absolute, out uri)) path = uri.AbsolutePath;
                }

                Log(firstLine);
                if (path == "/api/activate" || path == "/api/verify" || path == "/api/unbind")
                {
                    WriteJson(stream, 200, path == "/api/unbind" ? "{\"ok\":true,\"message\":\"OK\"}" : LicenseJson);
                }
                else if (path.StartsWith("/local/export_sessions", StringComparison.OrdinalIgnoreCase))
                {
                    WriteJson(stream, 200, ExportSessions(GetQueryValue(path, "target")));
                }
                else if (path.StartsWith("/local/cleanup_orphan_sessions", StringComparison.OrdinalIgnoreCase))
                {
                    WriteJson(stream, 200, CleanupOrphanSessions());
                }
                else
                {
                    WriteJson(stream, 404, "{\"ok\":false,\"message\":\"Unhandled path\"}");
                }
            }
            catch (Exception ex)
            {
                Log("Client error: " + ex.Message);
            }
        }
    }

    private static int IndexOf(byte[] haystack, int length, byte[] needle)
    {
        for (int i = 0; i <= length - needle.Length; i++)
        {
            bool ok = true;
            for (int j = 0; j < needle.Length; j++)
            {
                if (haystack[i + j] != needle[j]) { ok = false; break; }
            }
            if (ok) return i;
        }
        return -1;
    }

    private static void WriteJson(NetworkStream stream, int status, string json)
    {
        byte[] body = Encoding.UTF8.GetBytes(json);
        string reason = status == 200 ? "OK" : "Not Found";
        string head = "HTTP/1.1 " + status + " " + reason + "\r\n" +
                      "Content-Type: application/json; charset=utf-8\r\n" +
                      "Access-Control-Allow-Origin: *\r\n" +
                      "Content-Length: " + body.Length + "\r\n" +
                      "Connection: close\r\n\r\n";
        byte[] headBytes = Encoding.ASCII.GetBytes(head);
        stream.Write(headBytes, 0, headBytes.Length);
        stream.Write(body, 0, body.Length);
    }

    private static string GetQueryValue(string path, string key)
    {
        int q = path.IndexOf('?');
        if (q < 0 || q == path.Length - 1) return "";
        string query = path.Substring(q + 1);
        foreach (string part in query.Split('&'))
        {
            int eq = part.IndexOf('=');
            string k = eq >= 0 ? part.Substring(0, eq) : part;
            if (!string.Equals(Uri.UnescapeDataString(k), key, StringComparison.OrdinalIgnoreCase)) continue;
            string v = eq >= 0 ? part.Substring(eq + 1) : "";
            return Uri.UnescapeDataString(v.Replace("+", " "));
        }
        return "";
    }

    private static string ExportSessions(string targetDir)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(targetDir)) return "{\"ok\":false,\"error\":\"未选择导出目录\"}";
            Directory.CreateDirectory(targetDir);

            string sessionsDir = Path.Combine(_appRoot, "sessions");
            if (!Directory.Exists(sessionsDir)) return "{\"ok\":false,\"error\":\"未找到 sessions 目录\"}";

            string stamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
            string exportDir = Path.Combine(targetDir, "Fzdn1_sessions_" + stamp);
            Directory.CreateDirectory(exportDir);

            int sessionCount = 0;
            foreach (string file in Directory.GetFiles(sessionsDir, "*", SearchOption.AllDirectories))
            {
                string rel = file.Substring(sessionsDir.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                string dst = Path.Combine(exportDir, "sessions", rel);
                Directory.CreateDirectory(Path.GetDirectoryName(dst));
                File.Copy(file, dst, true);
                if (file.EndsWith(".session", StringComparison.OrdinalIgnoreCase)) sessionCount++;
            }

            CopyIfExists(Path.Combine(_appRoot, "session_config.json"), Path.Combine(exportDir, "session_config.json"));
            CopyIfExists(Path.Combine(_appRoot, "session_string_cache.json"), Path.Combine(exportDir, "session_string_cache.json"));

            File.WriteAllText(
                Path.Combine(exportDir, "使用说明.txt"),
                "这是 Fzdn1 TG Tool 导出的账号 Session。\\r\\n" +
                "导入时请优先使用软件内的“导入 Session”功能。\\r\\n" +
                "如果手动复制，请把 sessions 文件夹内的文件复制到安装目录的 sessions 文件夹，并同时复制 session_config.json。\\r\\n" +
                "这些文件是 Telegram 登录凭证，不要发给无关人员。\\r\\n",
                Encoding.UTF8
            );

            string safePath = JsonEscape(exportDir);
            return "{\"ok\":true,\"count\":" + sessionCount + ",\"path\":\"" + safePath + "\"}";
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + JsonEscape(ex.Message) + "\"}";
        }
    }

    private static string CleanupOrphanSessions()
    {
        try
        {
            string sessionsDir = Path.Combine(_appRoot, "sessions");
            if (!Directory.Exists(sessionsDir)) return "{\"ok\":true,\"moved\":0,\"message\":\"sessions directory not found\"}";

            HashSet<string> configured = LoadConfiguredSessionNames(Path.Combine(_appRoot, "session_config.json"));
            string[] sessionFiles = Directory.GetFiles(sessionsDir, "*.session", SearchOption.TopDirectoryOnly);
            int moved = 0;
            string backupDir = "";

            foreach (string sessionFile in sessionFiles)
            {
                string name = Path.GetFileNameWithoutExtension(sessionFile);
                if (configured.Contains(name)) continue;

                if (backupDir.Length == 0)
                {
                    backupDir = Path.Combine(_appRoot, "runtime_logs", "orphan_sessions_backup", DateTime.Now.ToString("yyyyMMdd_HHmmss"));
                    Directory.CreateDirectory(backupDir);
                }

                MoveIfExists(sessionFile, Path.Combine(backupDir, Path.GetFileName(sessionFile)));
                MoveIfExists(Path.Combine(sessionsDir, name + ".json"), Path.Combine(backupDir, name + ".json"));
                MoveIfExists(Path.Combine(sessionsDir, name + ".session-journal"), Path.Combine(backupDir, name + ".session-journal"));
                MoveIfExists(Path.Combine(sessionsDir, name + ".session-wal"), Path.Combine(backupDir, name + ".session-wal"));
                MoveIfExists(Path.Combine(sessionsDir, name + ".session-shm"), Path.Combine(backupDir, name + ".session-shm"));
                moved++;
            }

            if (moved > 0) Log("Moved orphan sessions: " + moved + " -> " + backupDir);
            return "{\"ok\":true,\"moved\":" + moved + ",\"backup\":\"" + JsonEscape(backupDir) + "\"}";
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + JsonEscape(ex.Message) + "\"}";
        }
    }

    private static HashSet<string> LoadConfiguredSessionNames(string configPath)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (!File.Exists(configPath)) return names;

        string text = File.ReadAllText(configPath, Encoding.UTF8);
        int depth = 0;
        bool inString = false;
        bool escaping = false;
        string lastTopLevelString = null;

        for (int i = 0; i < text.Length; i++)
        {
            char ch = text[i];
            if (inString)
            {
                if (escaping)
                {
                    escaping = false;
                }
                else if (ch == '\\')
                {
                    escaping = true;
                }
                else if (ch == '"')
                {
                    int end = i;
                    int start = end - 1;
                    while (start >= 0)
                    {
                        int slashCount = 0;
                        int k = start;
                        while (k >= 0 && text[k] == '\\') { slashCount++; k--; }
                        if (text[start] == '"' && slashCount % 2 == 0) break;
                        start--;
                    }
                    if (start >= 0 && depth == 1)
                    {
                        lastTopLevelString = text.Substring(start + 1, end - start - 1);
                    }
                    inString = false;
                }
                continue;
            }

            if (ch == '"')
            {
                inString = true;
                lastTopLevelString = null;
            }
            else if (ch == '{')
            {
                depth++;
            }
            else if (ch == '}')
            {
                depth = Math.Max(0, depth - 1);
            }
            else if (ch == ':' && depth == 1 && !string.IsNullOrEmpty(lastTopLevelString))
            {
                names.Add(UnescapeJsonString(lastTopLevelString));
                lastTopLevelString = null;
            }
            else if (!char.IsWhiteSpace(ch))
            {
                if (ch != ':') lastTopLevelString = null;
            }
        }
        return names;
    }

    private static string UnescapeJsonString(string value)
    {
        return value.Replace("\\\"", "\"").Replace("\\\\", "\\");
    }

    private static void MoveIfExists(string src, string dst)
    {
        if (!File.Exists(src)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(dst));
        if (File.Exists(dst)) File.Delete(dst);
        File.Move(src, dst);
    }

    private static void CopyIfExists(string src, string dst)
    {
        if (!File.Exists(src)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(dst));
        File.Copy(src, dst, true);
    }

    private static string JsonEscape(string value)
    {
        if (value == null) return "";
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }

    private static bool IsPortOpen(string host, int port)
    {
        try
        {
            using (var client = new TcpClient())
            {
                var result = client.BeginConnect(host, port, null, null);
                bool ok = result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(300));
                if (!ok) return false;
                client.EndConnect(result);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void Log(string line)
    {
        try
        {
            Directory.CreateDirectory(_logDir);
            File.AppendAllText(Path.Combine(_logDir, "license_proxy.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ") + line + Environment.NewLine);
        }
        catch { }
    }

    private static string QuoteArg(string arg)
    {
        if (string.IsNullOrEmpty(arg)) return "\"\"";
        return "\"" + arg.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
    }
}

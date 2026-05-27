using System;
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
    private const int LicensePort = 19803;
    private const string LicenseJson = "{\"ok\":true,\"message\":\"OK\",\"expire_ts\":7258118399,\"expire\":\"2199-12-31\"}";
    private static string _logDir = "";

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
            _logDir = Path.Combine(root, "runtime_logs");

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
            psi.EnvironmentVariables["HTTP_PROXY"] = "http://127.0.0.1:19803";
            psi.EnvironmentVariables["http_proxy"] = "http://127.0.0.1:19803";
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
        if (IsPortOpen("127.0.0.1", LicensePort)) return;
        var thread = new Thread(LicenseProxyLoop) { IsBackground = true };
        thread.Start();
        Thread.Sleep(300);
    }

    private static void LicenseProxyLoop()
    {
        try
        {
            var listener = new TcpListener(IPAddress.Parse("127.0.0.1"), LicensePort);
            listener.Start();
            Log("Embedded license proxy listening on 127.0.0.1:" + LicensePort);
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
                      "Content-Length: " + body.Length + "\r\n" +
                      "Connection: close\r\n\r\n";
        byte[] headBytes = Encoding.ASCII.GetBytes(head);
        stream.Write(headBytes, 0, headBytes.Length);
        stream.Write(body, 0, body.Length);
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

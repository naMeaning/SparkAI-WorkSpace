using System.Diagnostics;
using System.Text;
using System.Windows.Forms;

namespace NaimageStudioDevLauncher;

internal static class Program
{
    private const string DefaultProjectRoot = @"E:\项目\Image\naimage-studio";
    private const string NodeOverrideVariable = "NAIMAGE_STUDIO_NODE_EXE";
    private static readonly object LogGate = new();

    [STAThread]
    private static void Main()
    {
        var projectRoot = Environment.GetEnvironmentVariable("NAIMAGE_STUDIO_DEV_ROOT")?.Trim();
        if (string.IsNullOrWhiteSpace(projectRoot)) projectRoot = DefaultProjectRoot;
        var logPath = Path.Combine(projectRoot, ".diagnostics", "dev-launcher.log");
        StreamWriter? log = null;

        try
        {
            if (!Directory.Exists(projectRoot) || !File.Exists(Path.Combine(projectRoot, "package.json")))
            {
                throw new DirectoryNotFoundException($"未找到 naimage 开发项目：{projectRoot}");
            }

            Directory.CreateDirectory(Path.Combine(projectRoot, ".diagnostics"));
            log = TryOpenLog(logPath);

            var nodeExecutable = ResolveNodeExecutable();
            var devScript = Path.Combine(projectRoot, "scripts", "dev.mjs");
            if (!File.Exists(devScript))
            {
                throw new FileNotFoundException($"未找到开发启动脚本：{devScript}", devScript);
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = nodeExecutable,
                WorkingDirectory = projectRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            startInfo.Environment.Remove("FORCE_COLOR");
            startInfo.Environment["NO_COLOR"] = "1";
            startInfo.ArgumentList.Add(devScript);

            WriteLog(log, $"Starting \"{nodeExecutable}\" \"{devScript}\".");

            using var process = new Process { StartInfo = startInfo };
            process.OutputDataReceived += (_, eventArgs) => WriteChildOutput(log, "stdout", eventArgs.Data);
            process.ErrorDataReceived += (_, eventArgs) => WriteChildOutput(log, "stderr", eventArgs.Data);
            if (!process.Start()) throw new InvalidOperationException("无法启动开发环境。");
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            process.WaitForExit();
            WriteLog(log, $"Development process exited with code {process.ExitCode}.");
        }
        catch (Exception error)
        {
            log ??= TryOpenLog(logPath);
            WriteLog(log, $"Launch failed: {error}");
            MessageBox.Show(
                $"{error.Message}{Environment.NewLine}{Environment.NewLine}诊断日志：{logPath}",
                "naimage 开发启动失败",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
        finally
        {
            log?.Dispose();
        }
    }

    private static string ResolveNodeExecutable()
    {
        var configured = Environment.GetEnvironmentVariable(NodeOverrideVariable)?.Trim().Trim('"');
        if (!string.IsNullOrWhiteSpace(configured))
        {
            var expanded = Environment.ExpandEnvironmentVariables(configured);
            if (File.Exists(expanded)) return Path.GetFullPath(expanded);

            throw new FileNotFoundException(
                $"环境变量 {NodeOverrideVariable} 指向的 Node.js 不存在：{expanded}",
                expanded
            );
        }

        var pathValue = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var entry in pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var directory = Environment.ExpandEnvironmentVariables(entry.Trim().Trim('"'));
            if (string.IsNullOrWhiteSpace(directory)) continue;

            var candidate = Path.Combine(directory, "node.exe");
            if (File.Exists(candidate)) return Path.GetFullPath(candidate);
        }

        throw new FileNotFoundException(
            $"未找到 Node.js。请先安装 Node.js，或通过 {NodeOverrideVariable} 指定 node.exe。"
        );
    }

    private static StreamWriter? TryOpenLog(string logPath)
    {
        try
        {
            var stream = new FileStream(
                logPath,
                FileMode.Append,
                FileAccess.Write,
                FileShare.ReadWrite | FileShare.Delete
            );
            return new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true };
        }
        catch
        {
            return null;
        }
    }

    private static void WriteChildOutput(StreamWriter? log, string streamName, string? message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        WriteLog(log, $"{streamName}: {message}");
    }

    private static void WriteLog(StreamWriter? log, string message)
    {
        if (log is null) return;

        try
        {
            lock (LogGate)
            {
                log.WriteLine($"[{DateTimeOffset.Now:O}] {message}");
            }
        }
        catch
        {
            // Diagnostics must never prevent the development launcher from starting.
        }
    }
}

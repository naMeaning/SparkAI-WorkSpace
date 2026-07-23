using Naimage.WindowsInstaller;
using Microsoft.Win32;
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        NativeMethods.EnablePerMonitorDpi();
        var dataPolicyProbe = BrandCapture.ArgumentValue(args, "--data-policy-probe");
        if (!string.IsNullOrWhiteSpace(dataPolicyProbe)) return UninstallerDataPolicyProbe.Run(dataPolicyProbe!);
        var options = UninstallArguments.Parse(args);
        if (string.IsNullOrWhiteSpace(BrandCapture.ArgumentValue(args, "--capture")) &&
            !options.Silent &&
            UninstallerBootstrap.RelaunchOutsideInstallIfNeeded(args, options))
            return 0;
        if (options.Silent)
        {
            try { return UninstallerEngine.UninstallAsync(options, null).GetAwaiter().GetResult().ExitCode; }
            catch { return 1; }
        }

        var application = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        var window = new UninstallerWindow(args, options);
        if (BrandCapture.TryCapture(window, args)) return 0;
        application.Run(window);
        if (options.Detached && window.ResultCode == 0) UninstallerEngine.ScheduleDetachedCleanup();
        return window.ResultCode;
    }
}

internal static class UninstallerDataPolicyProbe
{
    internal static int Run(string destination)
    {
        try
        {
            var window = new UninstallerWindow(Array.Empty<string>(), UninstallArguments.Parse(Array.Empty<string>()));
            var backRestoresPreserve = window.VerifyDataBackPreservesForDiagnostics();
            var pageControlsReusable = window.VerifyPageReuseForDiagnostics();
            var closeHelpMatchesWindow = string.Equals(
                System.Windows.Automation.AutomationProperties.GetHelpText(window.CloseButton),
                "关闭 naimage 卸载程序",
                StringComparison.Ordinal);
            var versionInfo = FileVersionInfo.GetVersionInfo(typeof(Program).Assembly.Location);
            var productVersion = versionInfo.ProductVersion ?? "";
            var metadataClean = !string.IsNullOrWhiteSpace(productVersion) &&
                                !productVersion.Contains("+") &&
                                string.Equals(versionInfo.ProductName, "naimage", StringComparison.Ordinal) &&
                                string.Equals(versionInfo.CompanyName, "Aieyra", StringComparison.Ordinal);
            window.Close();
            var path = Path.GetFullPath(destination);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var ok = backRestoresPreserve && pageControlsReusable && closeHelpMatchesWindow && metadataClean;
            File.WriteAllText(path,
                "{\"ok\":" + ok.ToString().ToLowerInvariant() +
                ",\"backRestoresPreserve\":" + backRestoresPreserve.ToString().ToLowerInvariant() +
                ",\"pageControlsReusable\":" + pageControlsReusable.ToString().ToLowerInvariant() +
                ",\"closeHelpMatchesWindow\":" + closeHelpMatchesWindow.ToString().ToLowerInvariant() +
                ",\"productVersion\":\"" + productVersion.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"" +
                ",\"metadataClean\":" + metadataClean.ToString().ToLowerInvariant() + "}\n",
                Encoding.UTF8);
            return ok ? 0 : 1;
        }
        catch (Exception error)
        {
            try
            {
                var path = Path.GetFullPath(destination);
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                var safe = (error.GetType().Name + ": " + error.Message)
                    .Replace("\\", "\\\\")
                    .Replace("\"", "\\\"")
                    .Replace("\r", " ")
                    .Replace("\n", " ");
                File.WriteAllText(path, "{\"ok\":false,\"error\":\"" + safe + "\"}\n", Encoding.UTF8);
            }
            catch { }
            return 1;
        }
    }
}

internal sealed class UninstallArguments
{
    internal UninstallArguments(string installDirectory, bool deleteUserData, bool silent, bool updated, bool detached,
        string userDataDirectory, string localDataDirectory, bool diagnosticFailBeforeCore)
    {
        InstallDirectory = installDirectory;
        DeleteUserData = deleteUserData;
        Silent = silent;
        Updated = updated;
        Detached = detached;
        UserDataDirectory = userDataDirectory;
        LocalDataDirectory = localDataDirectory;
        DiagnosticFailBeforeCore = diagnosticFailBeforeCore;
    }

    internal string InstallDirectory { get; }
    internal bool DeleteUserData { get; }
    internal bool Silent { get; }
    internal bool Updated { get; }
    internal bool Detached { get; }
    internal string UserDataDirectory { get; }
    internal string LocalDataDirectory { get; }
    internal bool DiagnosticFailBeforeCore { get; }

    internal static UninstallArguments Parse(string[] args)
    {
        var directory = args
            .Where(argument => argument.StartsWith("--install-dir=", StringComparison.OrdinalIgnoreCase))
            .Select(argument => argument.Substring(14).Trim('"'))
            .FirstOrDefault();
        directory ??= args
            .Where(argument => argument.StartsWith("_?=", StringComparison.OrdinalIgnoreCase))
            .Select(argument => argument.Substring(3).Trim('"'))
            .FirstOrDefault();
        directory ??= FindRegisteredInstallDirectory();
        directory ??= AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        var userDataDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "naimage");
        var localDataDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "naimage");
        const string diagnosticUserDataPrefix = "--diagnostic-user-data-dir=";
        const string diagnosticLocalDataPrefix = "--diagnostic-local-data-dir=";
        var diagnosticUserDataOverride = args
            .Where(argument => argument.StartsWith(diagnosticUserDataPrefix, StringComparison.OrdinalIgnoreCase))
            .Select(argument => argument.Substring(diagnosticUserDataPrefix.Length).Trim('"'))
            .FirstOrDefault();
        var diagnosticLocalDataOverride = args
            .Where(argument => argument.StartsWith(diagnosticLocalDataPrefix, StringComparison.OrdinalIgnoreCase))
            .Select(argument => argument.Substring(diagnosticLocalDataPrefix.Length).Trim('"'))
            .FirstOrDefault();
        var diagnosticOverrideAllowed = string.Equals(
            Environment.GetEnvironmentVariable("NAIMAGE_INSTALLER_DIAGNOSTIC_ALLOW_DATA_OVERRIDE"),
            "1",
            StringComparison.Ordinal);
        if (diagnosticOverrideAllowed && !string.IsNullOrWhiteSpace(diagnosticUserDataOverride))
        {
            userDataDirectory = Path.GetFullPath(diagnosticUserDataOverride!);
        }
        if (diagnosticOverrideAllowed && !string.IsNullOrWhiteSpace(diagnosticLocalDataOverride))
        {
            localDataDirectory = Path.GetFullPath(diagnosticLocalDataOverride!);
        }
        return new UninstallArguments(
            Path.GetFullPath(directory),
            args.Any(argument => string.Equals(argument, "--delete-app-data", StringComparison.OrdinalIgnoreCase)),
            args.Any(argument => string.Equals(argument, "/S", StringComparison.OrdinalIgnoreCase) || string.Equals(argument, "--silent", StringComparison.OrdinalIgnoreCase)),
            args.Any(argument => string.Equals(argument, "--updated", StringComparison.OrdinalIgnoreCase)),
            args.Any(argument => string.Equals(argument, "--detached", StringComparison.OrdinalIgnoreCase)),
            userDataDirectory,
            localDataDirectory,
            args.Any(argument => string.Equals(argument, "--diagnostic-fail-before-core", StringComparison.OrdinalIgnoreCase)));
    }

    private static string? FindRegisteredInstallDirectory()
    {
        const string keyPath = @"Software\887890c3-49de-5e86-9a32-28781d680b7f";
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        {
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using var baseKey = RegistryKey.OpenBaseKey(hive, view);
                    using var key = baseKey.OpenSubKey(keyPath);
                    var value = Convert.ToString(key?.GetValue("InstallLocation"))?.Trim();
                    if (!string.IsNullOrWhiteSpace(value) && File.Exists(Path.Combine(value, "naimage.exe"))) return value;
                }
                catch { }
            }
        }
        return null;
    }
}

internal static class UninstallerBootstrap
{
    internal static bool RelaunchOutsideInstallIfNeeded(string[] args, UninstallArguments options)
    {
        if (options.Detached) return false;
        string? tempRoot = null;
        try
        {
            var current = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrWhiteSpace(current)) return false;
            var installRoot = Path.GetFullPath(options.InstallDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var currentPath = Path.GetFullPath(current);
            if (!currentPath.StartsWith(installRoot, StringComparison.OrdinalIgnoreCase)) return false;

            tempRoot = Path.Combine(Path.GetTempPath(), "naimage-studio-uninstaller", "ui-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempRoot);
            var detachedPath = Path.Combine(tempRoot, "naimage-uninstaller.exe");
            File.Copy(currentPath, detachedPath, true);
            var forwarded = new System.Collections.Generic.List<string>(args)
            {
                "--detached",
                "--install-dir=" + options.InstallDirectory
            };
            var process = Process.Start(new ProcessStartInfo(detachedPath)
            {
                UseShellExecute = false,
                WorkingDirectory = tempRoot,
                Arguments = WindowsCommandLine.Join(forwarded.ToArray())
            });
            if (process is null) throw new InvalidOperationException("无法启动临时品牌卸载器。");
            process.Dispose();
            return true;
        }
        catch
        {
            try { if (!string.IsNullOrWhiteSpace(tempRoot) && Directory.Exists(tempRoot)) Directory.Delete(tempRoot, true); } catch { }
            // If the temporary copy cannot start, continue in-place. The
            // uninstaller engine can still schedule self-removal after commit.
            return false;
        }
    }
}

internal sealed class UninstallProgress
{
    internal UninstallProgress(int percent, string stage, string detail) { Percent = percent; Stage = stage; Detail = detail; }
    internal int Percent { get; }
    internal string Stage { get; }
    internal string Detail { get; }
}

internal sealed class UninstallResult
{
    internal UninstallResult(int exitCode, bool success, string message, string logPath)
    { ExitCode = exitCode; Success = success; Message = message; LogPath = logPath; }
    internal int ExitCode { get; }
    internal bool Success { get; }
    internal string Message { get; }
    internal string LogPath { get; }
}

internal static class UninstallerEngine
{
    private static readonly TimeSpan DefaultCoreTimeout = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan DefaultRecoveryTimeout = TimeSpan.FromMinutes(8);

    internal static async Task<UninstallResult> UninstallAsync(UninstallArguments options, IProgress<UninstallProgress>? progress)
    {
        var stamp = DateTimeOffset.Now.ToString("yyyyMMdd-HHmmss-fff") + "-" +
                    Process.GetCurrentProcess().Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var logRoot = Path.Combine(options.LocalDataDirectory, "installer-logs");
        Directory.CreateDirectory(logRoot);
        var logPath = Path.Combine(logRoot, $"uninstall-{stamp}.log");
        var log = new StringBuilder();
        IDisposable? operationLease = null;
        var joinedParentUpgrade = options.Silent && options.Updated &&
                                  BrandOperationLock.TryJoinInherited(out operationLease);
        if (!joinedParentUpgrade && !BrandOperationLock.TryAcquire(out operationLease))
        {
            log.AppendLine($"[{DateTimeOffset.Now:O}] another install or uninstall operation is active");
            await WriteAllTextAsync(logPath, log.ToString());
            return new UninstallResult(1618, false,
                "另一个 naimage 安装、更新或卸载操作正在进行，请等待其完成后重试。", logPath);
        }
        log.AppendLine($"[{DateTimeOffset.Now:O}] operationLock={(joinedParentUpgrade ? "joined-parent-upgrade" : "owner")}");
        var tempRoot = Path.Combine(Path.GetTempPath(), "naimage-studio-uninstaller", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempRoot);
        var tempCore = Path.Combine(tempRoot, "naimage-core-uninstaller.exe");
        try
        {
            progress?.Report(new UninstallProgress(12, "准备卸载", "正在检查程序文件与运行状态"));
            if (PathAccess.RequiresElevation(options.InstallDirectory))
                throw new InvalidOperationException("当前安装位置需要管理员权限，v1 品牌卸载器不会切换到其他管理员账户。请联系支持人员处理此旧版安装。");
            if (options.DiagnosticFailBeforeCore)
                throw new InvalidOperationException("Diagnostic failure requested before uninstall commit.");
            var core = Path.Combine(options.InstallDirectory, "Uninstall naimage.exe");
            if (!File.Exists(core))
            {
                if (!File.Exists(Path.Combine(options.InstallDirectory, "naimage.exe")))
                {
                    if (options.DeleteUserData)
                        await DeleteManagedDataAsync(options, log);
                    ScheduleSelfRemoval(options.InstallDirectory);
                    if (!options.DeleteUserData) await WriteAllTextAsync(logPath, log.ToString());
                    return new UninstallResult(0, true, "程序组件已经移除。", logPath);
                }
                throw new InvalidOperationException("未找到安全卸载内核，请重新安装当前版本后再卸载。");
            }
            File.Copy(core, tempCore, true);
            log.AppendLine($"[{DateTimeOffset.Now:O}] install={options.InstallDirectory}");
            log.AppendLine($"deleteUserData={options.DeleteUserData}");
            progress?.Report(new UninstallProgress(34, "移除程序组件", "正在关闭应用并清理安装目录"));

            var arguments = new System.Collections.Generic.List<string> { "/S", "/currentuser" };
            if (options.Updated) arguments.Add("--updated");
            arguments.Add($"_?={options.InstallDirectory}");
            var percent = 38;
            var coreTimeout = ProcessWatchdog.ResolveTimeout(
                "NAIMAGE_UNINSTALLER_DIAGNOSTIC_CORE_TIMEOUT_MS",
                DefaultCoreTimeout);
            var recoveryTimeout = ProcessWatchdog.ResolveTimeout(
                "NAIMAGE_UNINSTALLER_DIAGNOSTIC_RECOVERY_TIMEOUT_MS",
                DefaultRecoveryTimeout);
            var coreExitCode = await RunCoreWithWatchdogAsync(
                tempCore,
                tempRoot,
                WindowsCommandLine.Join(arguments.ToArray()),
                coreTimeout,
                recoveryTimeout,
                progress,
                log,
                () =>
                {
                    percent = Math.Min(91, percent + 3);
                    progress?.Report(new UninstallProgress(percent,
                        percent < 72 ? "移除程序组件" : "清理系统入口",
                        percent < 72 ? "正在移除应用文件" : "正在移除快捷方式和注册信息"));
                });
            if (coreExitCode != 0) throw new InvalidOperationException($"卸载内核返回错误代码 {coreExitCode}。");
            var installedExecutable = Path.Combine(options.InstallDirectory, "naimage.exe");
            // NSIS can return after handing its final directory/shortcut cleanup
            // to the copied uninstaller process. Observe the committed state
            // instead of racing those last filesystem operations.
            for (var retry = 0; retry < 180 && File.Exists(installedExecutable); retry++)
                await Task.Delay(250);
            if (File.Exists(installedExecutable))
                throw new InvalidOperationException("程序仍在运行，未能完整移除。请关闭 naimage 后重试。");

            if (options.DeleteUserData)
            {
                progress?.Report(new UninstallProgress(94, "清理本地数据", "正在移除会话、缓存与内部项目库"));
                await DeleteManagedDataAsync(options, log);
            }

            progress?.Report(new UninstallProgress(100, "卸载完成", options.DeleteUserData
                ? "程序与本地用户数据均已移除"
                : "程序已移除，项目与设置保持不变"));
            if (!options.DeleteUserData) await WriteAllTextAsync(logPath, log.ToString());
            ScheduleSelfRemoval(options.InstallDirectory);
            if (options.Detached && options.Silent) ScheduleDetachedCleanup();
            return new UninstallResult(0, true, "卸载完成。", logPath);
        }
        catch (Exception error)
        {
            log.AppendLine($"[{DateTimeOffset.Now:O}] failure={error.GetType().Name}: {error.Message}");
            await WriteAllTextAsync(logPath, log.ToString());
            return new UninstallResult(1, false, error.Message, logPath);
        }
        finally
        {
            TryDelete(tempCore);
            TryDeleteDirectory(tempRoot);
            operationLease?.Dispose();
        }
    }

    private static async Task<int> RunCoreWithWatchdogAsync(
        string corePath,
        string workingDirectory,
        string arguments,
        TimeSpan firstTimeout,
        TimeSpan recoveryTimeout,
        IProgress<UninstallProgress>? progress,
        StringBuilder log,
        Action heartbeat)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var timeout = attempt == 0 ? firstTimeout : recoveryTimeout;
            var start = new ProcessStartInfo(corePath)
            {
                WorkingDirectory = workingDirectory,
                WindowStyle = ProcessWindowStyle.Hidden,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var process = Process.Start(start) ?? throw new InvalidOperationException("无法启动卸载内核。");
            log.AppendLine($"[{DateTimeOffset.Now:O}] core attempt={attempt + 1} pid={process.Id} timeoutMs={(long)timeout.TotalMilliseconds}");
            var completed = await ProcessWatchdog.WaitForExitAsync(
                process,
                timeout,
                TimeSpan.FromMilliseconds(260),
                System.Threading.CancellationToken.None,
                heartbeat);
            if (completed)
            {
                log.AppendLine($"[{DateTimeOffset.Now:O}] core attempt={attempt + 1} exit={process.ExitCode}");
                return process.ExitCode;
            }

            log.AppendLine($"[{DateTimeOffset.Now:O}] core attempt={attempt + 1} watchdog timeout");
            if (attempt == 0)
            {
                progress?.Report(new UninstallProgress(42, "恢复卸载", "卸载内核响应超时，正在重新检查并继续清理"));
            }
        }
        throw new TimeoutException("卸载内核长时间未响应，已停止本次操作。请关闭 naimage 后重试；重复执行会继续清理未完成的组件。");
    }

    private static void ScheduleSelfRemoval(string installDirectory)
    {
        string? current = null;
        try { current = Process.GetCurrentProcess().MainModule?.FileName; } catch { }
        if (string.IsNullOrWhiteSpace(current)) return;
        var normalizedInstall = Path.GetFullPath(installDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var normalizedCurrent = Path.GetFullPath(current);
        if (!normalizedCurrent.StartsWith(normalizedInstall, StringComparison.OrdinalIgnoreCase)) return;
        ScheduleCleanupScript(normalizedCurrent, Path.GetFullPath(installDirectory));
    }

    internal static void ScheduleDetachedCleanup()
    {
        string? current = null;
        try { current = Process.GetCurrentProcess().MainModule?.FileName; } catch { }
        if (string.IsNullOrWhiteSpace(current)) return;
        var parent = Path.GetDirectoryName(current);
        if (string.IsNullOrWhiteSpace(parent)) return;
        ScheduleCleanupScript(Path.GetFullPath(current), Path.GetFullPath(parent));
    }

    private static void ScheduleCleanupScript(string filePath, string directoryPath)
    {
        try
        {
            var normalizedFile = Path.GetFullPath(filePath);
            var normalizedDirectory = Path.GetFullPath(directoryPath).TrimEnd(Path.DirectorySeparatorChar);
            var parent = Path.GetDirectoryName(normalizedFile)?.TrimEnd(Path.DirectorySeparatorChar);
            if (!string.Equals(parent, normalizedDirectory, StringComparison.OrdinalIgnoreCase)) return;

            var scriptRoot = Path.Combine(Path.GetTempPath(), "naimage-studio-uninstaller", "cleanup");
            Directory.CreateDirectory(scriptRoot);
            var scriptPath = Path.Combine(scriptRoot, "cleanup-" + Guid.NewGuid().ToString("N") + ".cmd");
            File.WriteAllText(scriptPath,
                "@echo off\r\n" +
                "ping 127.0.0.1 -n 3 > nul\r\n" +
                "del /f /q \"%NAIMAGE_DELETE_FILE%\" > nul 2>&1\r\n" +
                "rmdir \"%NAIMAGE_DELETE_DIR%\" > nul 2>&1\r\n" +
                "del /f /q \"%~f0\" > nul 2>&1\r\n",
                Encoding.ASCII);
            var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                Arguments = "/d /c " + WindowsCommandLine.Quote(scriptPath)
            };
            start.EnvironmentVariables["NAIMAGE_DELETE_FILE"] = normalizedFile;
            start.EnvironmentVariables["NAIMAGE_DELETE_DIR"] = normalizedDirectory;
            Process.Start(start);
            MoveFileEx(normalizedFile, null, 0x4);
        }
        catch { }
    }

    private static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }
    private static void TryDeleteDirectory(string path) { try { if (Directory.Exists(path)) Directory.Delete(path, true); } catch { } }
    private static Task WriteAllTextAsync(string path, string content) => Task.Run(() => File.WriteAllText(path, content, Encoding.UTF8));

    private static async Task DeleteManagedDataAsync(UninstallArguments options, StringBuilder log)
    {
        var roamingRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "naimage");
        var localRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "naimage");
        await DeleteManagedDirectoryAsync(options.UserDataDirectory, roamingRoot, "user-data", log);
        if (!string.Equals(
                Path.GetFullPath(options.LocalDataDirectory).TrimEnd(Path.DirectorySeparatorChar),
                Path.GetFullPath(options.UserDataDirectory).TrimEnd(Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase))
        {
            await DeleteManagedDirectoryAsync(options.LocalDataDirectory, localRoot, "local-data", log);
        }
    }

    private static async Task DeleteManagedDirectoryAsync(string directory, string expectedDefault, string label, StringBuilder log)
    {
        var target = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar);
        var defaultRoot = Path.GetFullPath(expectedDefault).TrimEnd(Path.DirectorySeparatorChar);
        var diagnosticOverrideAllowed = string.Equals(
            Environment.GetEnvironmentVariable("NAIMAGE_INSTALLER_DIAGNOSTIC_ALLOW_DATA_OVERRIDE"),
            "1",
            StringComparison.Ordinal);
        if (!string.Equals(target, defaultRoot, StringComparison.OrdinalIgnoreCase) && !diagnosticOverrideAllowed)
            throw new InvalidOperationException("拒绝清理未授权的用户数据目录。");
        var root = Path.GetPathRoot(target)?.TrimEnd(Path.DirectorySeparatorChar);
        if (string.IsNullOrWhiteSpace(target) || string.Equals(target, root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("拒绝清理磁盘根目录。");

        log.AppendLine($"[{DateTimeOffset.Now:O}] {label}={target}");
        if (!Directory.Exists(target)) return;
        await Task.Run(() => Directory.Delete(target, true));
        if (Directory.Exists(target)) throw new InvalidOperationException("本地用户数据未能完整清理，请关闭占用文件的程序后重试。");
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool MoveFileEx(string existingFileName, string? newFileName, int flags);
}

internal sealed class UninstallerWindow : BrandWindow
{
    private enum PageKind { Confirm, DataConfirmation, Progress, Complete, Error }

    private readonly UninstallArguments _options;
    private readonly BrandToggle _preserveToggle;
    private readonly ProgressBar _progressBar;
    private readonly TextBlock _progressStage;
    private readonly TextBlock _progressDetail;
    private readonly TextBlock _errorDetail;
    private PageKind _page;
    private bool _working;
    private bool _dataDeletionConfirmed;

    internal int ResultCode { get; private set; } = 1223;

    internal UninstallerWindow(string[] args, UninstallArguments options)
        : base("naimage 卸载程序", "安全卸载")
    {
        _options = options;
        _preserveToggle = new BrandToggle("保留项目、会话、设置与图片库（推荐）", true);
        _progressBar = MakeProgressBar();
        _progressStage = Text("准备卸载", 17, BrandPalette.Text, FontWeights.SemiBold);
        _progressDetail = Text("正在检查程序文件", 12, BrandPalette.Muted);
        _errorDetail = Text("", 12, BrandPalette.Danger);
        BackButton.Visibility = Visibility.Collapsed;
        BackButton.Click += (_, _) => HandleBack();
        SecondaryButton.Click += (_, _) => Close();
        PrimaryButton.Click += async (_, _) => await HandlePrimaryAsync();

        var capturePage = BrandCapture.ArgumentValue(args, "--capture-page")?.ToLowerInvariant();
        switch (capturePage)
        {
            case "data-confirm": _preserveToggle.IsChecked = false; ShowDataConfirmation(); break;
            case "progress": ShowProgressPreview(); break;
            case "complete": ShowComplete(true); break;
            case "error": ShowError("naimage 仍在运行，请关闭后重试。", @"C:\Users\Demo\AppData\Local\naimage\installer-logs\uninstall.log"); break;
            default: ShowConfirm(); break;
        }
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (_working) { e.Cancel = true; return; }
        base.OnClosing(e);
    }

    private void HandleBack()
    {
        if (_page == PageKind.DataConfirmation) _preserveToggle.IsChecked = true;
        ShowConfirm();
    }

    internal bool VerifyDataBackPreservesForDiagnostics()
    {
        _preserveToggle.IsChecked = false;
        ShowDataConfirmation();
        HandleBack();
        return _page == PageKind.Confirm && _preserveToggle.IsChecked;
    }

    internal bool VerifyPageReuseForDiagnostics()
    {
        ShowProgressPreview();
        ShowError("诊断错误", "诊断日志");
        ShowProgressPreview();
        ShowError("再次诊断错误", "诊断日志");
        return _page == PageKind.Error;
    }

    private void ShowConfirm()
    {
        _page = PageKind.Confirm;
        _dataDeletionConfirmed = false;
        DetachFromLogicalParent(_preserveToggle);
        var stack = new StackPanel();
        stack.Children.Add(StatusPill("默认不会删除创作数据", BrandPalette.Mint));
        var summary = new StackPanel();
        var location = Text("程序位置", 10.5, BrandPalette.Muted, FontWeights.SemiBold);
        summary.Children.Add(location);
        var path = Text(_options.InstallDirectory, 12.5, BrandPalette.Text, FontWeights.SemiBold);
        path.Margin = new Thickness(0, 4, 0, 0);
        path.TextWrapping = TextWrapping.NoWrap;
        path.TextTrimming = TextTrimming.CharacterEllipsis;
        path.ToolTip = _options.InstallDirectory;
        summary.Children.Add(path);
        var alwaysRemove = Text("程序文件与快捷方式：始终移除", 10.5, Color.FromRgb(169, 204, 201));
        alwaysRemove.Margin = new Thickness(0, 10, 0, 0);
        summary.Children.Add(alwaysRemove);
        summary.Children.Add(Text("内部项目库、会话与设置：默认保留", 10.5, BrandPalette.Muted));
        var summaryCard = Card(summary, new Thickness(16));
        summaryCard.Margin = new Thickness(0, 15, 0, 0);
        stack.Children.Add(summaryCard);
        _preserveToggle.Margin = new Thickness(0, 13, 0, 0);
        stack.Children.Add(_preserveToggle);
        var warning = Text("关闭此选项会同时清理本机账户下的会话、FastMemory、缓存、图片库与安装日志。位于其他目录的外部项目不会被删除。", 11, Color.FromRgb(177, 153, 128));
        var warningCard = Card(warning, new Thickness(14, 12, 14, 12));
        warningCard.Margin = new Thickness(0, 13, 0, 0);
        warningCard.BorderBrush = BrandPalette.Brush(Color.FromRgb(91, 73, 50));
        stack.Children.Add(warningCard);
        SetPage("UNINSTALL", "卸载 naimage", "移除程序组件与系统快捷入口。你可以明确决定是否保留本地创作数据。", stack);
        BackButton.Visibility = Visibility.Collapsed;
        SecondaryButton.Visibility = Visibility.Visible;
        SetButtonLabel(SecondaryButton, "取消");
        PrimaryButton.Visibility = Visibility.Visible;
        PrimaryButton.IsEnabled = true;
        SetButtonLabel(PrimaryButton, "开始卸载");
        SetButtonTone(PrimaryButton, BrandButtonTone.Primary);
        CloseEnabled = true;
        SetKeyboardButtons(PrimaryButton, SecondaryButton);
        FooterNote.Text = "建议保留数据，方便以后重新安装后继续工作";
    }

    private void ShowDataConfirmation()
    {
        _page = PageKind.DataConfirmation;
        var stack = new StackPanel();
        stack.Children.Add(StatusPill("危险操作 · 需要再次确认", BrandPalette.Danger));

        var removals = new StackPanel();
        removals.Children.Add(Text("将被删除", 11, BrandPalette.Danger, FontWeights.SemiBold));
        var details = Text("• 本机内部项目库与图片副本\n• 会话、FastMemory 与应用设置\n• 缓存、更新文件、安装与运行日志", 12, BrandPalette.Text);
        details.Margin = new Thickness(0, 8, 0, 0);
        removals.Children.Add(details);
        var removalCard = Card(removals, new Thickness(16));
        removalCard.Margin = new Thickness(0, 14, 0, 0);
        removalCard.BorderBrush = BrandPalette.Brush(Color.FromRgb(112, 54, 60));
        stack.Children.Add(removalCard);

        var preserved = new StackPanel();
        preserved.Children.Add(Text("不会删除", 11, BrandPalette.Mint, FontWeights.SemiBold));
        var preservedDetails = Text("用户自行选择并保存在其他目录的外部项目和原始图片。", 11.5, BrandPalette.Muted);
        preservedDetails.Margin = new Thickness(0, 6, 0, 0);
        preserved.Children.Add(preservedDetails);
        var preservedCard = Card(preserved, new Thickness(16));
        preservedCard.Margin = new Thickness(0, 12, 0, 0);
        preservedCard.BorderBrush = BrandPalette.Brush(Color.FromRgb(31, 101, 91));
        stack.Children.Add(preservedCard);

        SetPage("CONFIRM CLEANUP", "确认清理本地创作数据", "此选择无法撤销。若只是暂时卸载，请返回并保留数据。", stack);
        BackButton.Visibility = Visibility.Visible;
        SetButtonLabel(BackButton, "返回保留");
        SecondaryButton.Visibility = Visibility.Visible;
        SetButtonLabel(SecondaryButton, "取消");
        PrimaryButton.Visibility = Visibility.Visible;
        PrimaryButton.IsEnabled = true;
        SetButtonLabel(PrimaryButton, "确认清理并卸载");
        SetButtonTone(PrimaryButton, BrandButtonTone.Danger);
        CloseEnabled = true;
        SetKeyboardButtons(PrimaryButton, SecondaryButton);
        FooterNote.Text = "再次确认后才会清理本地数据";
    }

    private void ShowProgressPreview()
    {
        _progressBar.Value = 62;
        _progressStage.Text = "移除程序组件";
        _progressDetail.Text = "正在清理应用文件与系统入口";
        ShowProgress();
    }

    private void ShowProgress()
    {
        _page = PageKind.Progress;
        DetachFromLogicalParent(_progressStage);
        DetachFromLogicalParent(_progressDetail);
        DetachFromLogicalParent(_progressBar);
        var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        stack.Children.Add(StatusPill(_preserveToggle.IsChecked ? "项目与设置将被保留" : "本地用户数据将一并清理",
            _preserveToggle.IsChecked ? BrandPalette.Mint : BrandPalette.Danger));
        _progressStage.Margin = new Thickness(0, 22, 0, 4);
        stack.Children.Add(_progressStage);
        stack.Children.Add(_progressDetail);
        _progressBar.Margin = new Thickness(0, 24, 0, 0);
        stack.Children.Add(_progressBar);
        SetPage("REMOVING", "正在卸载 naimage", "请保持此窗口开启，卸载器会先关闭应用再安全移除组件。", stack);
        BackButton.Visibility = Visibility.Collapsed;
        SecondaryButton.Visibility = Visibility.Collapsed;
        PrimaryButton.Visibility = Visibility.Collapsed;
        PrimaryButton.IsEnabled = false;
        SetButtonLabel(PrimaryButton, "处理中");
        CloseEnabled = false;
        SetKeyboardButtons(null, null);
        FooterNote.Text = "卸载过程不会触碰用户自行选择的外部项目目录";
    }

    private void ShowComplete(bool preserve)
    {
        _page = PageKind.Complete;
        var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        var mark = new Border
        {
            Width = 68,
            Height = 68,
            CornerRadius = new CornerRadius(24),
            Background = BrandPalette.Brush(BrandPalette.Mint),
            HorizontalAlignment = HorizontalAlignment.Left,
            Child = Text("✓", 31, BrandPalette.Ink, FontWeights.Bold),
            Padding = new Thickness(0, 10, 0, 0)
        };
        ((TextBlock)mark.Child).TextAlignment = TextAlignment.Center;
        stack.Children.Add(mark);
        var title = Text("naimage 已从这台电脑移除。", 17, BrandPalette.Text, FontWeights.SemiBold);
        title.Margin = new Thickness(0, 20, 0, 8);
        stack.Children.Add(title);
        stack.Children.Add(Text(preserve
            ? "项目、会话、设置和图片库仍保留在本机，重新安装后可继续使用。"
            : "本地用户数据已按你的明确选择一并清理。", 12.5, BrandPalette.Muted));
        SetPage("COMPLETE", "卸载完成", "程序组件、快捷方式与注册信息已安全清理。", stack);
        BackButton.Visibility = Visibility.Collapsed;
        SecondaryButton.Visibility = Visibility.Collapsed;
        PrimaryButton.Visibility = Visibility.Visible;
        PrimaryButton.IsEnabled = true;
        SetButtonLabel(PrimaryButton, "完成");
        SetButtonTone(PrimaryButton, BrandButtonTone.Primary);
        CloseEnabled = true;
        SetKeyboardButtons(PrimaryButton, null);
        FooterNote.Text = preserve ? "感谢使用 naimage" : "本地数据清理已完成";
    }

    private void ShowError(string message, string logPath)
    {
        _page = PageKind.Error;
        DetachFromLogicalParent(_errorDetail);
        _errorDetail.Text = message;
        var stack = new StackPanel();
        stack.Children.Add(StatusPill("卸载未完成", BrandPalette.Danger));
        var card = Card(_errorDetail, new Thickness(16));
        card.Margin = new Thickness(0, 15, 0, 0);
        card.BorderBrush = BrandPalette.Brush(Color.FromRgb(104, 54, 60));
        stack.Children.Add(card);
        var log = Text($"诊断日志：{logPath}", 10.5, Color.FromRgb(118, 150, 155));
        log.Margin = new Thickness(0, 12, 0, 0);
        stack.Children.Add(log);
        SetPage("ERROR", "未能完成卸载", "卸载器已停止继续操作；已完成的系统清理不会回滚。请根据下方原因处理后重试。", stack);
        BackButton.Visibility = Visibility.Collapsed;
        SecondaryButton.Visibility = Visibility.Visible;
        SetButtonLabel(SecondaryButton, "退出");
        PrimaryButton.Visibility = Visibility.Visible;
        PrimaryButton.IsEnabled = true;
        SetButtonLabel(PrimaryButton, "重试");
        SetButtonTone(PrimaryButton, BrandButtonTone.Primary);
        CloseEnabled = true;
        SetKeyboardButtons(PrimaryButton, SecondaryButton);
        FooterNote.Text = "如问题持续，请将诊断日志发送给支持人员";
    }

    private async Task HandlePrimaryAsync()
    {
        if (_page == PageKind.Complete) { Close(); return; }
        if (_page == PageKind.Confirm && !_preserveToggle.IsChecked && !_dataDeletionConfirmed)
        {
            ShowDataConfirmation();
            return;
        }
        if (_page == PageKind.DataConfirmation) _dataDeletionConfirmed = true;
        if (_page is not (PageKind.Confirm or PageKind.DataConfirmation or PageKind.Error)) return;
        _working = true;
        _progressBar.Value = 10;
        ShowProgress();
        var progress = new Progress<UninstallProgress>(value =>
        {
            _progressBar.Value = value.Percent;
            _progressStage.Text = value.Stage;
            _progressDetail.Text = value.Detail;
        });
        var options = new UninstallArguments(_options.InstallDirectory, !_preserveToggle.IsChecked, _options.Silent,
            _options.Updated, _options.Detached, _options.UserDataDirectory, _options.LocalDataDirectory,
            _options.DiagnosticFailBeforeCore);
        var result = await UninstallerEngine.UninstallAsync(options, progress);
        _working = false;
        ResultCode = result.ExitCode;
        if (result.Success) ShowComplete(_preserveToggle.IsChecked);
        else ShowError(result.Message, result.LogPath);
    }
}

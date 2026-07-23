using Naimage.WindowsInstaller;
using Microsoft.Win32;
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation.Peers;
using System.Windows.Automation.Provider;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        NativeMethods.EnablePerMonitorDpi();
        var automationProbe = BrandCapture.ArgumentValue(args, "--toggle-automation-probe");
        if (!string.IsNullOrWhiteSpace(automationProbe)) return InstallerAccessibilityProbe.Run(automationProbe!);
        var folderPickerProbe = BrandCapture.ArgumentValue(args, "--folder-picker-probe");
        if (!string.IsNullOrWhiteSpace(folderPickerProbe)) return InstallerShellProbe.Run(folderPickerProbe!);
        var watchdogProbe = BrandCapture.ArgumentValue(args, "--watchdog-probe");
        if (!string.IsNullOrWhiteSpace(watchdogProbe)) return InstallerWatchdogProbe.Run(watchdogProbe!);
        var operationLockProbe = BrandCapture.ArgumentValue(args, "--operation-lock-probe");
        if (!string.IsNullOrWhiteSpace(operationLockProbe)) return InstallerOperationLockProbe.Run(operationLockProbe!);
        var versionPolicyProbe = BrandCapture.ArgumentValue(args, "--version-policy-probe");
        if (!string.IsNullOrWhiteSpace(versionPolicyProbe)) return InstallerVersionPolicyProbe.Run(versionPolicyProbe!);
        if (InstallArguments.IsSilent(args))
        {
            try
            {
                return InstallerEngine.InstallAsync(InstallArguments.Parse(args), null, CancellationToken.None)
                    .GetAwaiter().GetResult().ExitCode;
            }
            catch
            {
                return 1;
            }
        }

        var application = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        var window = new InstallerWindow(args);
        if (BrandCapture.TryCapture(window, args)) return 0;
        application.Run(window);
        return window.ResultCode;
    }
}

internal static class InstallerShellProbe
{
    internal static int Run(string destination)
    {
        try
        {
            var ok = ModernFolderPicker.TryProbe(out var error);
            var path = Path.GetFullPath(destination);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var safeError = error.Replace("\\", "\\\\").Replace("\"", "\\\"");
            File.WriteAllText(path,
                "{\"ok\":" + ok.ToString().ToLowerInvariant() +
                ",\"modernExplorerDialog\":" + ok.ToString().ToLowerInvariant() +
                ",\"legacyFolderBrowserDialog\":false,\"error\":\"" + safeError + "\"}\n",
                Encoding.UTF8);
            return ok ? 0 : 1;
        }
        catch
        {
            return 1;
        }
    }
}

internal static class InstallerAccessibilityProbe
{
    internal static int Run(string destination)
    {
        try
        {
            var toggle = new BrandToggle("自动化测试选项", true);
            var peer = toggle.CreateAutomationPeerForDiagnostics();
            var provider = peer.GetPattern(PatternInterface.Toggle) as IToggleProvider;
            var before = toggle.IsChecked;
            provider?.Toggle();
            var after = toggle.IsChecked;
            var automationName = System.Windows.Automation.AutomationProperties.GetName(toggle);
            var window = new InstallerWindow(Array.Empty<string>());
            var primaryContent = Convert.ToString(window.PrimaryButton.Content) ?? "";
            var secondaryContent = Convert.ToString(window.SecondaryButton.Content) ?? "";
            var primaryAutomationName = System.Windows.Automation.AutomationProperties.GetName(window.PrimaryButton);
            var secondaryAutomationName = System.Windows.Automation.AutomationProperties.GetName(window.SecondaryButton);
            var buttonLabelsSynchronized =
                string.Equals(primaryContent, primaryAutomationName, StringComparison.Ordinal) &&
                string.Equals(secondaryContent, secondaryAutomationName, StringComparison.Ordinal);
            var primaryIsDefault = window.PrimaryButton.IsDefault;
            var secondaryIsCancel = window.SecondaryButton.IsCancel;
            var closeAutomationName = System.Windows.Automation.AutomationProperties.GetName(window.CloseButton);
            window.PrimaryButton.IsEnabled = false;
            var disabledButtonVisuallyDistinct = window.PrimaryButton.Opacity < 0.75;
            window.PrimaryButton.IsEnabled = true;
            var pageControlsReusable = window.VerifyPageReuseForDiagnostics();
            var versionInfo = FileVersionInfo.GetVersionInfo(Assembly.GetExecutingAssembly().Location);
            var productVersion = versionInfo.ProductVersion ?? "";
            var metadataClean = !string.IsNullOrWhiteSpace(productVersion) &&
                                !productVersion.Contains("+") &&
                                string.Equals(versionInfo.ProductName, "naimage", StringComparison.Ordinal) &&
                                string.Equals(versionInfo.CompanyName, "Aieyra", StringComparison.Ordinal);
            window.Close();
            var ok = toggle.Focusable && toggle.IsTabStop && provider is not null && before && !after &&
                      string.Equals(automationName, "自动化测试选项", StringComparison.Ordinal) &&
                      buttonLabelsSynchronized && primaryIsDefault && secondaryIsCancel &&
                      string.Equals(closeAutomationName, "关闭窗口", StringComparison.Ordinal) &&
                      disabledButtonVisuallyDistinct && pageControlsReusable && metadataClean;
            var path = Path.GetFullPath(destination);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var report = new Dictionary<string, object>
            {
                ["ok"] = ok,
                ["isTabStop"] = toggle.IsTabStop,
                ["focusable"] = toggle.Focusable,
                ["togglePattern"] = provider is not null,
                ["spaceSemantics"] = "ToggleButton",
                ["name"] = "自动化测试选项",
                ["buttonLabelsSynchronized"] = buttonLabelsSynchronized,
                ["primaryContent"] = primaryContent,
                ["primaryAutomationName"] = primaryAutomationName,
                ["primaryIsDefault"] = primaryIsDefault,
                ["secondaryContent"] = secondaryContent,
                ["secondaryAutomationName"] = secondaryAutomationName,
                ["secondaryIsCancel"] = secondaryIsCancel,
                ["closeAutomationName"] = closeAutomationName,
                ["disabledButtonVisuallyDistinct"] = disabledButtonVisuallyDistinct,
                ["pageControlsReusable"] = pageControlsReusable,
                ["productVersion"] = productVersion,
                ["metadataClean"] = metadataClean
            };
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(report) + "\n", Encoding.UTF8);
            return ok ? 0 : 1;
        }
        catch
        {
            return 1;
        }
    }
}

internal sealed class InstallArguments
{
    internal InstallArguments(string installDirectory, bool desktopShortcut, bool startMenuShortcut,
        bool launchAfter, bool diagnosticFailBeforeCore, bool diagnosticCancelBeforeCore,
        bool preserveExistingShortcutPreferences, bool allowDowngrade)
    {
        InstallDirectory = installDirectory;
        DesktopShortcut = desktopShortcut;
        StartMenuShortcut = startMenuShortcut;
        LaunchAfter = launchAfter;
        DiagnosticFailBeforeCore = diagnosticFailBeforeCore;
        DiagnosticCancelBeforeCore = diagnosticCancelBeforeCore;
        PreserveExistingShortcutPreferences = preserveExistingShortcutPreferences;
        AllowDowngrade = allowDowngrade;
    }

    internal string InstallDirectory { get; }
    internal bool DesktopShortcut { get; }
    internal bool StartMenuShortcut { get; }
    internal bool LaunchAfter { get; }
    internal bool DiagnosticFailBeforeCore { get; }
    internal bool DiagnosticCancelBeforeCore { get; }
    internal bool PreserveExistingShortcutPreferences { get; }
    internal bool AllowDowngrade { get; }

    internal static readonly string DefaultInstallDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs",
        "naimage");

    internal static bool IsSilent(string[] args) => args.Any(argument =>
        string.Equals(argument, "/S", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(argument, "--silent", StringComparison.OrdinalIgnoreCase));

    internal static InstallArguments Parse(string[] args, string? uiInstallDirectory = null,
        bool desktop = true, bool startMenu = true, bool launchAfter = false)
    {
        var directory = uiInstallDirectory;
        var desktopPreferenceExplicit = args.Any(value =>
            string.Equals(value, "--desktop", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(value, "--no-desktop", StringComparison.OrdinalIgnoreCase));
        var startMenuPreferenceExplicit = args.Any(value =>
            string.Equals(value, "--start-menu", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(value, "--no-start-menu", StringComparison.OrdinalIgnoreCase));
        foreach (var argument in args)
        {
            if (argument.StartsWith("/D=", StringComparison.OrdinalIgnoreCase))
                directory = argument.Substring(3).Trim('"');
            else if (argument.StartsWith("--install-dir=", StringComparison.OrdinalIgnoreCase))
                directory = argument.Substring(14).Trim('"');
        }
        return new InstallArguments(
            Path.GetFullPath(string.IsNullOrWhiteSpace(directory) ? DefaultInstallDirectory : directory),
            (desktop || args.Any(value => string.Equals(value, "--desktop", StringComparison.OrdinalIgnoreCase))) &&
                !args.Any(value => string.Equals(value, "--no-desktop", StringComparison.OrdinalIgnoreCase)),
            (startMenu || args.Any(value => string.Equals(value, "--start-menu", StringComparison.OrdinalIgnoreCase))) &&
                !args.Any(value => string.Equals(value, "--no-start-menu", StringComparison.OrdinalIgnoreCase)),
            launchAfter || args.Any(value => string.Equals(value, "--launch", StringComparison.OrdinalIgnoreCase)),
            args.Any(value => string.Equals(value, "--diagnostic-fail-before-core", StringComparison.OrdinalIgnoreCase)),
            args.Any(value => string.Equals(value, "--diagnostic-cancel-before-core", StringComparison.OrdinalIgnoreCase)),
            uiInstallDirectory is null && !desktopPreferenceExplicit && !startMenuPreferenceExplicit,
            args.Any(value => string.Equals(value, "--allow-downgrade", StringComparison.OrdinalIgnoreCase)));
    }
}

internal static class InstallerWatchdogProbe
{
    internal static int Run(string destination)
    {
        Process? sleeper = null;
        try
        {
            sleeper = Process.Start(new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                Arguments = "/d /c ping.exe 127.0.0.1 -n 30 > nul"
            }) ?? throw new InvalidOperationException("无法启动 watchdog 诊断进程。");
            var completedBeforeTimeout = ProcessWatchdog.WaitForExitAsync(
                    sleeper,
                    TimeSpan.FromMilliseconds(180),
                    TimeSpan.FromMilliseconds(25),
                    CancellationToken.None)
                .GetAwaiter().GetResult();
            var processTerminated = sleeper.HasExited;

            using var recovery = Process.Start(new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                Arguments = "/d /c exit 0"
            }) ?? throw new InvalidOperationException("无法启动 watchdog 恢复诊断进程。");
            var recoveryCompleted = ProcessWatchdog.WaitForExitAsync(
                    recovery,
                    TimeSpan.FromSeconds(5),
                    TimeSpan.FromMilliseconds(25),
                    CancellationToken.None)
                .GetAwaiter().GetResult();
            var ok = !completedBeforeTimeout && processTerminated && recoveryCompleted && recovery.ExitCode == 0;
            var path = Path.GetFullPath(destination);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var report = new Dictionary<string, object>
            {
                ["ok"] = ok,
                ["timedOut"] = !completedBeforeTimeout,
                ["processTerminated"] = processTerminated,
                ["recoveryCompleted"] = recoveryCompleted,
                ["recoveryExitCode"] = recovery.ExitCode
            };
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(report) + "\n", Encoding.UTF8);
            return ok ? 0 : 1;
        }
        catch
        {
            if (sleeper is not null) ProcessWatchdog.TryTerminateTree(sleeper);
            return 1;
        }
        finally
        {
            sleeper?.Dispose();
        }
    }
}

internal static class InstallerOperationLockProbe
{
    internal static int Run(string destination)
    {
        IDisposable? first = null;
        IDisposable? joined = null;
        IDisposable? afterRelease = null;
        var previousToken = Environment.GetEnvironmentVariable(
            BrandOperationLock.OperationTokenEnvironmentName,
            EnvironmentVariableTarget.Process);
        try
        {
            var firstAcquired = BrandOperationLock.TryAcquire(out first, out var operationToken);
            var concurrentRejected = !BrandOperationLock.TryAcquire(out var concurrent);
            concurrent?.Dispose();
            Environment.SetEnvironmentVariable(
                BrandOperationLock.OperationTokenEnvironmentName,
                operationToken,
                EnvironmentVariableTarget.Process);
            var validInheritedJoin = BrandOperationLock.TryJoinInherited(out joined);
            joined?.Dispose();
            joined = null;
            Environment.SetEnvironmentVariable(
                BrandOperationLock.OperationTokenEnvironmentName,
                Guid.NewGuid().ToString("N"),
                EnvironmentVariableTarget.Process);
            var wrongTokenRejected = !BrandOperationLock.TryJoinInherited(out var wrongJoin);
            wrongJoin?.Dispose();
            Environment.SetEnvironmentVariable(
                BrandOperationLock.OperationTokenEnvironmentName,
                previousToken,
                EnvironmentVariableTarget.Process);
            first?.Dispose();
            first = null;
            var reacquiredAfterRelease = BrandOperationLock.TryAcquire(out afterRelease);
            var ok = firstAcquired && concurrentRejected && validInheritedJoin &&
                     wrongTokenRejected && reacquiredAfterRelease;
            var path = Path.GetFullPath(destination);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var report = new Dictionary<string, object>
            {
                ["ok"] = ok,
                ["firstAcquired"] = firstAcquired,
                ["concurrentRejected"] = concurrentRejected,
                ["validInheritedJoin"] = validInheritedJoin,
                ["wrongTokenRejected"] = wrongTokenRejected,
                ["reacquiredAfterRelease"] = reacquiredAfterRelease
            };
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(report) + "\n", Encoding.UTF8);
            return ok ? 0 : 1;
        }
        catch
        {
            return 1;
        }
        finally
        {
            Environment.SetEnvironmentVariable(
                BrandOperationLock.OperationTokenEnvironmentName,
                previousToken,
                EnvironmentVariableTarget.Process);
            joined?.Dispose();
            first?.Dispose();
            afterRelease?.Dispose();
        }
    }
}

internal static class InstallerVersionPolicy
{
    internal static string CurrentVersion()
    {
        try
        {
            var version = FileVersionInfo.GetVersionInfo(Assembly.GetExecutingAssembly().Location).FileVersion;
            if (!string.IsNullOrWhiteSpace(version)) return version!;
        }
        catch { }
        return "0.0.0";
    }

    internal static bool IsDowngrade(string installedVersion, string candidateVersion)
    {
        return TryParse(installedVersion, out var installed) &&
               TryParse(candidateVersion, out var candidate) &&
               installed > candidate;
    }

    private static bool TryParse(string value, out Version version)
    {
        version = new Version(0, 0, 0, 0);
        if (string.IsNullOrWhiteSpace(value)) return false;
        var core = value.Trim().TrimStart('v', 'V');
        var suffix = core.IndexOfAny(new[] { '-', '+', ' ' });
        if (suffix >= 0) core = core.Substring(0, suffix);
        var rawParts = core.Split('.');
        if (rawParts.Length < 2 || rawParts.Length > 4) return false;
        var parts = new int[4];
        for (var index = 0; index < rawParts.Length; index++)
        {
            if (!int.TryParse(rawParts[index], NumberStyles.None, CultureInfo.InvariantCulture, out parts[index]) || parts[index] < 0)
                return false;
        }
        version = new Version(parts[0], parts[1], parts[2], parts[3]);
        return true;
    }
}

internal static class InstallerVersionPolicyProbe
{
    internal static int Run(string destination)
    {
        try
        {
            var newerBlocked = InstallerVersionPolicy.IsDowngrade("1.0.4", "1.0.3");
            var sameAllowed = !InstallerVersionPolicy.IsDowngrade("1.0.3.0", "1.0.3");
            var upgradeAllowed = !InstallerVersionPolicy.IsDowngrade("1.0.2", "1.0.3.0");
            var suffixCompared = InstallerVersionPolicy.IsDowngrade("v2.1.0+stable", "2.0.9-beta");
            var unknownAllowed = !InstallerVersionPolicy.IsDowngrade("未知版本", "1.0.3");
            var ok = newerBlocked && sameAllowed && upgradeAllowed && suffixCompared && unknownAllowed;
            var path = Path.GetFullPath(destination);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var report = new Dictionary<string, object>
            {
                ["ok"] = ok,
                ["currentVersion"] = InstallerVersionPolicy.CurrentVersion(),
                ["newerBlocked"] = newerBlocked,
                ["sameAllowed"] = sameAllowed,
                ["upgradeAllowed"] = upgradeAllowed,
                ["suffixCompared"] = suffixCompared,
                ["unknownAllowed"] = unknownAllowed
            };
            File.WriteAllText(path, new JavaScriptSerializer().Serialize(report) + "\n", Encoding.UTF8);
            return ok ? 0 : 1;
        }
        catch
        {
            return 1;
        }
    }
}

internal sealed class ExistingInstallation
{
    private const string LegacyExecutableName = "iiimage Studio.exe";

    internal ExistingInstallation(string installDirectory, string version, RegistryHive hive)
    {
        InstallDirectory = installDirectory;
        Version = version;
        Hive = hive;
    }

    internal string InstallDirectory { get; }
    internal string Version { get; }
    internal RegistryHive Hive { get; }

    internal static ExistingInstallation? Find()
    {
        const string installKeyPath = @"Software\887890c3-49de-5e86-9a32-28781d680b7f";
        const string uninstallKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\887890c3-49de-5e86-9a32-28781d680b7f";
        var hives = string.Equals(
            Environment.GetEnvironmentVariable("NAIMAGE_INSTALLER_DIAGNOSTIC_IGNORE_MACHINE"),
            "1",
            StringComparison.Ordinal)
            ? new[] { RegistryHive.CurrentUser }
            : new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine };
        foreach (var hive in hives)
        {
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using var baseKey = RegistryKey.OpenBaseKey(hive, view);
                    using var installKey = baseKey.OpenSubKey(installKeyPath);
                    using var uninstallKey = baseKey.OpenSubKey(uninstallKeyPath);
                    var location = Convert.ToString(installKey?.GetValue("InstallLocation"))?.Trim();
                    if (string.IsNullOrWhiteSpace(location)) continue;
                    var hasCurrentExecutable = File.Exists(Path.Combine(location, "naimage.exe"));
                    var hasLegacyExecutable = File.Exists(Path.Combine(location, LegacyExecutableName));
                    if (uninstallKey is null || (!hasCurrentExecutable && !hasLegacyExecutable)) continue;
                    var version = Convert.ToString(uninstallKey?.GetValue("DisplayVersion"))?.Trim() ?? "未知版本";
                    return new ExistingInstallation(Path.GetFullPath(location), version, hive);
                }
                catch
                {
                    // A denied machine registry view should not prevent per-user installation.
                }
            }
        }
        return null;
    }
}

internal static class ShortcutState
{
    internal static bool DesktopExists() => DesktopPaths().Any(File.Exists);

    internal static bool StartMenuExists() => StartMenuPaths().Any(File.Exists);

    internal static IEnumerable<string> DesktopPaths() =>
        DesktopPathsForName("naimage.lnk").Concat(LegacyDesktopPaths());

    internal static IEnumerable<string> LegacyDesktopPaths() =>
        DesktopPathsForName("iiimage Studio.lnk");

    private static IEnumerable<string> DesktopPathsForName(string shortcutName)
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        if (!string.IsNullOrWhiteSpace(desktop)) yield return Path.Combine(desktop, shortcutName);
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!string.IsNullOrWhiteSpace(profile))
            yield return Path.Combine(profile, "OneDrive", "Desktop", shortcutName);
    }

    internal static IEnumerable<string> StartMenuPaths() =>
        StartMenuPathsForName("naimage", "naimage.lnk").Concat(LegacyStartMenuPaths());

    internal static IEnumerable<string> LegacyStartMenuPaths() =>
        StartMenuPathsForName("iiimage Studio", "iiimage Studio.lnk");

    private static IEnumerable<string> StartMenuPathsForName(string folderName, string shortcutName)
    {
        var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        if (string.IsNullOrWhiteSpace(programs)) yield break;
        yield return Path.Combine(programs, shortcutName);
        yield return Path.Combine(programs, folderName, shortcutName);
    }
}

internal sealed class InstallProgress
{
    internal InstallProgress(int percent, string stage, string detail) { Percent = percent; Stage = stage; Detail = detail; }
    internal int Percent { get; }
    internal string Stage { get; }
    internal string Detail { get; }
}

internal sealed class InstallResult
{
    internal InstallResult(int exitCode, bool success, bool cancelled, string message, string logPath)
    { ExitCode = exitCode; Success = success; Cancelled = cancelled; Message = message; LogPath = logPath; }
    internal int ExitCode { get; }
    internal bool Success { get; }
    internal bool Cancelled { get; }
    internal string Message { get; }
    internal string LogPath { get; }
}

internal static class InstallerEngine
{
    private const string CoreResource = "naimage.core-installer.exe";
    private const string HashResource = "naimage.core-installer.sha256";
    private static readonly TimeSpan DefaultCoreTimeout = TimeSpan.FromMinutes(20);
    private static readonly TimeSpan DefaultRecoveryTimeout = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan RollbackTimeout = TimeSpan.FromMinutes(5);

    internal static async Task<InstallResult> InstallAsync(
        InstallArguments options,
        IProgress<InstallProgress>? progress,
        CancellationToken cancellationToken)
    {
        var stamp = DateTimeOffset.Now.ToString("yyyyMMdd-HHmmss-fff") + "-" +
                    Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture);
        var logDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "naimage",
            "installer-logs");
        Directory.CreateDirectory(logDirectory);
        var logPath = Path.Combine(logDirectory, $"setup-{stamp}.log");
        var log = new StringBuilder();
        IDisposable? operationLease = null;
        if (!BrandOperationLock.TryAcquire(out operationLease, out var operationToken))
        {
            log.AppendLine($"[{DateTimeOffset.Now:O}] another install or uninstall operation is active");
            await WriteAllTextAsync(logPath, log.ToString());
            return new InstallResult(1618, false, false,
                "另一个 naimage 安装、更新或卸载操作正在进行，请等待其完成后重试。", logPath);
        }
        var existing = ExistingInstallation.Find();
        var wasFreshInstall = existing is null;
        var installDirectory = existing?.InstallDirectory ?? options.InstallDirectory;
        var desktopShortcut = existing is not null && options.PreserveExistingShortcutPreferences
            ? ShortcutState.DesktopExists()
            : options.DesktopShortcut;
        var startMenuShortcut = existing is not null && options.PreserveExistingShortcutPreferences
            ? ShortcutState.StartMenuExists()
            : options.StartMenuShortcut;
        var tempDirectory = Path.Combine(Path.GetTempPath(), "naimage-studio-installer", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDirectory);
        var corePath = Path.Combine(tempDirectory, "naimage-core-installer.exe");

        try
        {
            progress?.Report(new InstallProgress(8, "准备安装", "正在验证安装组件与目标目录"));
            ValidateInstallDirectory(installDirectory);
            var candidateVersion = InstallerVersionPolicy.CurrentVersion();
            if (existing is not null && !options.AllowDowngrade &&
                InstallerVersionPolicy.IsDowngrade(existing.Version, candidateVersion))
            {
                throw new InvalidOperationException(
                    $"这台电脑已安装较新的 naimage {existing.Version}。为保护项目兼容性，不能使用 {candidateVersion} 覆盖降级；请下载最新安装包。" );
            }
            if (PathAccess.RequiresElevation(installDirectory))
                throw new InvalidOperationException("当前版本仅支持安装到当前用户可写目录。请选择默认位置或其他个人文件夹。");
            if (options.DiagnosticCancelBeforeCore)
                return new InstallResult(1223, false, true, "安装已在写入前取消。", logPath);

            await Task.Run(() => ExtractAndVerifyCore(corePath), cancellationToken);
            log.AppendLine($"[{DateTimeOffset.Now:O}] core verified");
            log.AppendLine($"mode={(wasFreshInstall ? "install" : "upgrade")}");
            log.AppendLine($"target={installDirectory}");
            log.AppendLine($"pathLocked={existing is not null}");
            log.AppendLine($"shortcutPolicy={(options.PreserveExistingShortcutPreferences && existing is not null ? "preserve" : "explicit")}");
            log.AppendLine($"desktopShortcut={desktopShortcut}");
            log.AppendLine($"startMenuShortcut={startMenuShortcut}");
            if (options.DiagnosticFailBeforeCore)
                throw new InvalidOperationException("Diagnostic failure requested before installation commit.");

            cancellationToken.ThrowIfCancellationRequested();
            progress?.Report(new InstallProgress(20, existing is null ? "部署应用" : "安全更新", existing is null
                ? "正在安装 naimage 核心文件"
                : $"正在从 {existing.Version} 更新并保留项目与设置"));

            var simulatedPercent = 23;
            var coreTimeout = ProcessWatchdog.ResolveTimeout(
                "NAIMAGE_INSTALLER_DIAGNOSTIC_CORE_TIMEOUT_MS",
                DefaultCoreTimeout);
            var recoveryTimeout = ProcessWatchdog.ResolveTimeout(
                "NAIMAGE_INSTALLER_DIAGNOSTIC_RECOVERY_TIMEOUT_MS",
                DefaultRecoveryTimeout);
            var coreExitCode = await RunCoreWithWatchdogAsync(
                corePath,
                tempDirectory,
                installDirectory,
                operationToken,
                coreTimeout,
                recoveryTimeout,
                progress,
                log,
                cancellationToken,
                () =>
                {
                    simulatedPercent = Math.Min(88, simulatedPercent + (simulatedPercent < 58 ? 3 : 1));
                    progress?.Report(new InstallProgress(
                        simulatedPercent,
                        simulatedPercent < 63 ? "部署应用" : "配置系统集成",
                        simulatedPercent < 63 ? "正在解压并校验程序文件" : "正在配置快捷方式与卸载入口"));
                });
            if (coreExitCode != 0) throw new InvalidOperationException($"安装内核返回错误代码 {coreExitCode}。");

            var installedExe = Path.Combine(installDirectory, "naimage.exe");
            if (!File.Exists(installedExe)) throw new InvalidOperationException("安装完成后未找到 naimage.exe。");
            ApplyShortcutPreferences(desktopShortcut, startMenuShortcut);
            progress?.Report(new InstallProgress(100, "安装完成", "naimage 已准备就绪"));
            await WriteAllTextAsync(logPath, log.ToString());

            if (options.LaunchAfter)
            {
                Process.Start(new ProcessStartInfo(installedExe) { UseShellExecute = true, WorkingDirectory = installDirectory });
            }
            return new InstallResult(0, true, false, existing is null ? "安装完成。" : "更新完成。", logPath);
        }
        catch (OperationCanceledException)
        {
            operationLease?.Dispose();
            operationLease = null;
            if (wasFreshInstall) await RollbackFreshInstallAsync(installDirectory, log);
            log.AppendLine($"[{DateTimeOffset.Now:O}] cancelled");
            await WriteAllTextAsync(logPath, log.ToString());
            return new InstallResult(1223, false, true, "安装已安全取消。", logPath);
        }
        catch (Exception error)
        {
            log.AppendLine($"[{DateTimeOffset.Now:O}] failure={error.GetType().Name}: {error.Message}");
            operationLease?.Dispose();
            operationLease = null;
            if (wasFreshInstall) await RollbackFreshInstallAsync(installDirectory, log);
            await WriteAllTextAsync(logPath, log.ToString());
            return new InstallResult(1, false, false, error.Message, logPath);
        }
        finally
        {
            try { Directory.Delete(tempDirectory, true); } catch { }
            operationLease?.Dispose();
        }
    }

    private static async Task<int> RunCoreWithWatchdogAsync(
        string corePath,
        string workingDirectory,
        string installDirectory,
        string operationToken,
        TimeSpan firstTimeout,
        TimeSpan recoveryTimeout,
        IProgress<InstallProgress>? progress,
        StringBuilder log,
        CancellationToken cancellationToken,
        Action heartbeat)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var timeout = attempt == 0 ? firstTimeout : recoveryTimeout;
            var diagnosticStall = string.Equals(
                Environment.GetEnvironmentVariable("NAIMAGE_INSTALLER_DIAGNOSTIC_STALL_CORE"),
                "1",
                StringComparison.Ordinal) &&
                string.Equals(
                    Environment.GetEnvironmentVariable("NAIMAGE_INSTALLER_DIAGNOSTIC_ALLOW_TIMEOUT_OVERRIDE"),
                    "1",
                    StringComparison.Ordinal);
            var startInfo = diagnosticStall
                ? new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe")
                 {
                     UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = workingDirectory,
                    Arguments = "/d /c ping.exe 127.0.0.1 -n 30 > nul",
                    WindowStyle = ProcessWindowStyle.Hidden
                }
                : new ProcessStartInfo(corePath)
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = workingDirectory,
                    Arguments = WindowsCommandLine.Join("/S", "/currentuser", $"/D={installDirectory}"),
                     WindowStyle = ProcessWindowStyle.Hidden
                 };
            BrandOperationLock.AttachOperationToken(startInfo, operationToken);
            using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("无法启动安装内核。");
            log.AppendLine($"[{DateTimeOffset.Now:O}] core attempt={attempt + 1} pid={process.Id} timeoutMs={(long)timeout.TotalMilliseconds}");
            var completed = await ProcessWatchdog.WaitForExitAsync(
                process,
                timeout,
                TimeSpan.FromMilliseconds(360),
                cancellationToken,
                heartbeat);
            if (completed)
            {
                log.AppendLine($"[{DateTimeOffset.Now:O}] core attempt={attempt + 1} exit={process.ExitCode}");
                return process.ExitCode;
            }

            log.AppendLine($"[{DateTimeOffset.Now:O}] core attempt={attempt + 1} watchdog timeout");
            if (attempt == 0)
            {
                progress?.Report(new InstallProgress(32, "恢复部署", "安装内核响应超时，正在重新验证并继续部署"));
            }
        }
        throw new TimeoutException("安装内核长时间未响应，已停止安装并启动安全回滚。请释放磁盘空间、关闭安全软件拦截后重试。");
    }

    private static void ValidateInstallDirectory(string directory)
    {
        if (string.IsNullOrWhiteSpace(directory)) throw new InvalidOperationException("请选择安装位置。");
        var root = Path.GetPathRoot(directory);
        if (string.Equals(directory.TrimEnd(Path.DirectorySeparatorChar), root?.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("不能直接安装到磁盘根目录，请选择一个专用文件夹。");
        var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        foreach (var protectedRoot in new[] { windows, programFiles, programFilesX86 }.Where(value => !string.IsNullOrWhiteSpace(value)))
        {
            if (IsWithin(directory, protectedRoot))
                throw new InvalidOperationException($"当前版本不支持将 {directory} 安装到受保护目录 {protectedRoot}。请选择默认位置或其他个人文件夹。");
        }
        var managedDataRoots = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "naimage"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "naimage"),
            // Keep legacy data roots protected during upgrades from the former product name.
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "iiimage Studio"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "iiimage Studio")
        };
        foreach (var managedRoot in managedDataRoots.Where(value => !string.IsNullOrWhiteSpace(value)))
        {
            if (IsWithin(directory, managedRoot) || IsWithin(managedRoot, directory))
                throw new InvalidOperationException("安装目录不能与 naimage 的项目、会话、设置或缓存目录重叠。请选择默认位置或其他专用文件夹。");
        }
    }

    private static bool IsWithin(string candidate, string root)
    {
        if (string.IsNullOrWhiteSpace(root)) return false;
        var normalizedCandidate = Path.GetFullPath(candidate).TrimEnd(Path.DirectorySeparatorChar);
        var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        if (!string.Equals(Path.GetPathRoot(normalizedCandidate), Path.GetPathRoot(normalizedRoot), StringComparison.OrdinalIgnoreCase))
            return false;
        return string.Equals(normalizedCandidate, normalizedRoot, StringComparison.OrdinalIgnoreCase) ||
               normalizedCandidate.StartsWith(normalizedRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    private static void ExtractAndVerifyCore(string destination)
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var core = assembly.GetManifestResourceStream(CoreResource)
            ?? throw new InvalidOperationException("安装包缺少经过完整性封装的核心组件。");
        using (var output = File.Create(destination)) core.CopyTo(output);
        using var hashStream = assembly.GetManifestResourceStream(HashResource)
            ?? throw new InvalidOperationException("安装包缺少核心完整性信息。");
        using var reader = new StreamReader(hashStream, Encoding.ASCII);
        var expected = reader.ReadToEnd().Trim().ToLowerInvariant();
        string actual;
        using (var sha = SHA256.Create())
        using (var input = new FileStream(destination, FileMode.Open, FileAccess.Read, FileShare.Read,
                   1024 * 1024, FileOptions.SequentialScan))
            actual = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant();
        if (expected.Length != 64 || !FixedTimeEquals(expected, actual))
            throw new InvalidOperationException("安装组件完整性校验失败，请重新从官网下载。");
    }

    private static void ApplyShortcutPreferences(bool desktopShortcut, bool startMenuShortcut)
    {
        if (!desktopShortcut)
        {
            foreach (var shortcut in ShortcutState.DesktopPaths()) TryDelete(shortcut);
        }
        else
        {
            foreach (var shortcut in ShortcutState.LegacyDesktopPaths()) TryDelete(shortcut);
        }
        if (!startMenuShortcut)
        {
            foreach (var shortcut in ShortcutState.StartMenuPaths()) TryDelete(shortcut);
        }
        else
        {
            foreach (var shortcut in ShortcutState.LegacyStartMenuPaths()) TryDelete(shortcut);
        }
        var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        if (string.IsNullOrWhiteSpace(programs)) return;
        if (!startMenuShortcut) TryDeleteDirectory(Path.Combine(programs, "naimage"));
        TryDeleteDirectory(Path.Combine(programs, "iiimage Studio"));
    }

    private static async Task RollbackFreshInstallAsync(string installDirectory, StringBuilder log)
    {
        var brandedUninstaller = Path.Combine(installDirectory, "naimage-uninstaller.exe");
        var coreUninstaller = Path.Combine(installDirectory, "Uninstall naimage.exe");
        var uninstaller = File.Exists(brandedUninstaller) ? brandedUninstaller : coreUninstaller;
        if (File.Exists(uninstaller))
        {
            var temp = Path.Combine(Path.GetTempPath(), $"naimage-rollback-{Guid.NewGuid():N}.exe");
            try
            {
                File.Copy(uninstaller, temp, true);
                var isBranded = string.Equals(uninstaller, brandedUninstaller, StringComparison.OrdinalIgnoreCase);
                var rollbackCompleted = false;
                for (var attempt = 0; attempt < 2; attempt++)
                {
                    var start = new ProcessStartInfo(temp)
                    {
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        Arguments = isBranded
                            ? WindowsCommandLine.Join("/S", $"--install-dir={installDirectory}")
                            : WindowsCommandLine.Join("/S", "/currentuser", $"_?={installDirectory}")
                    };
                    using var process = Process.Start(start);
                    if (process is null) break;
                    var completed = await ProcessWatchdog.WaitForExitAsync(
                        process,
                        RollbackTimeout,
                        TimeSpan.FromMilliseconds(250),
                        CancellationToken.None);
                    log.AppendLine($"[{DateTimeOffset.Now:O}] fresh-install rollback attempt={attempt + 1} completed={completed} exit={(completed ? process.ExitCode.ToString(CultureInfo.InvariantCulture) : "timeout")}");
                    if (completed && process.ExitCode == 0)
                    {
                        rollbackCompleted = true;
                        break;
                    }
                }
                if (rollbackCompleted) return;
                log.AppendLine($"[{DateTimeOffset.Now:O}] fresh-install rollback remained incomplete");
            }
            catch (Exception error)
            {
                log.AppendLine($"[{DateTimeOffset.Now:O}] rollback failure={error.Message}");
            }
            finally
            {
                TryDelete(temp);
            }
        }
        try
        {
            if (Directory.Exists(installDirectory) && !Directory.EnumerateFileSystemEntries(installDirectory).Any())
                Directory.Delete(installDirectory);
        }
        catch { }
    }

    private static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }
    private static void TryDeleteDirectory(string path) { try { if (Directory.Exists(path) && !Directory.EnumerateFileSystemEntries(path).Any()) Directory.Delete(path); } catch { } }
    private static Task WriteAllTextAsync(string path, string content) => Task.Run(() => File.WriteAllText(path, content, Encoding.UTF8));
    private static bool FixedTimeEquals(string left, string right)
    {
        if (left.Length != right.Length) return false;
        var difference = 0;
        for (var index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
        return difference == 0;
    }
}

internal sealed class InstallerWindow : BrandWindow
{
    private enum PageKind { Welcome, Options, Progress, Complete, Error }

    private readonly string[] _args;
    private readonly ExistingInstallation? _existing;
    private readonly TextBox _pathBox;
    private readonly BrandToggle _desktopToggle;
    private readonly BrandToggle _startMenuToggle;
    private readonly BrandToggle _launchToggle;
    private readonly ProgressBar _progressBar;
    private readonly TextBlock _progressStage;
    private readonly TextBlock _progressDetail;
    private readonly TextBlock _errorDetail;
    private PageKind _page;
    private bool _installing;
    private bool _cancelFreshInstall;

    internal int ResultCode { get; private set; } = 1223;

    internal InstallerWindow(string[] args) : base("naimage 安装程序", "naimage · " + DisplayVersion())
    {
        _args = args;
        _existing = ExistingInstallation.Find();
        _pathBox = new TextBox
        {
            Text = _existing?.InstallDirectory ?? InstallArguments.DefaultInstallDirectory,
            Background = Brushes.Transparent,
            Foreground = BrandPalette.Brush(BrandPalette.Text),
            BorderThickness = new Thickness(0),
            FontSize = 12.5,
            VerticalContentAlignment = VerticalAlignment.Center,
            Padding = new Thickness(0),
            CaretBrush = BrandPalette.Brush(BrandPalette.Mint)
        };
        _desktopToggle = new BrandToggle("创建桌面快捷方式", _existing is null || ShortcutState.DesktopExists());
        _startMenuToggle = new BrandToggle("添加到开始菜单", _existing is null || ShortcutState.StartMenuExists());
        _launchToggle = new BrandToggle("完成后启动 naimage", true);
        _progressBar = MakeProgressBar();
        _progressStage = Text("准备安装", 17, BrandPalette.Text, FontWeights.SemiBold);
        _progressDetail = Text("正在检查安装环境", 12, BrandPalette.Muted);
        _errorDetail = Text("", 12, BrandPalette.Danger);

        BackButton.Click += (_, _) => HandleBack();
        SecondaryButton.Click += (_, _) => HandleSecondary();
        PrimaryButton.Click += async (_, _) => await HandlePrimaryAsync();
        ShowCapturePage(args);
    }

    private static string DisplayVersion()
    {
        try
        {
            var version = FileVersionInfo.GetVersionInfo(Assembly.GetExecutingAssembly().Location).FileVersion;
            if (!string.IsNullOrWhiteSpace(version)) return string.Join(".", version.Split('.').Take(3));
        }
        catch { }
        return "CURRENT";
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (_installing)
        {
            e.Cancel = true;
            return;
        }
        base.OnClosing(e);
    }

    private void ShowCapturePage(string[] args)
    {
        var page = BrandCapture.ArgumentValue(args, "--capture-page")?.ToLowerInvariant();
        switch (page)
        {
            case "options": ShowOptions(); break;
            case "progress": ShowProgressPreview(); break;
            case "complete": ShowComplete(false); break;
            case "error": ShowError("安装组件完整性校验失败，请重新从官网下载。", @"C:\Users\Demo\AppData\Local\naimage\installer-logs\setup.log"); break;
            default: ShowWelcome(); break;
        }
    }

    private void ShowWelcome()
    {
        _page = PageKind.Welcome;
        var stack = new StackPanel();
        if (_existing is not null)
        {
            var version = StatusPill($"已检测到 {_existing.Version} · 将保留项目与设置", BrandPalette.Blue);
            version.Margin = new Thickness(0, 0, 0, 14);
            stack.Children.Add(version);
        }
        if (_existing is null)
        {
            var features = new Grid();
            features.ColumnDefinitions.Add(new ColumnDefinition());
            features.ColumnDefinitions.Add(new ColumnDefinition());
            features.RowDefinitions.Add(new RowDefinition());
            features.RowDefinitions.Add(new RowDefinition());
            AddFeature(features, 0, 0, "01", "单 Agent 图像工作台", "自然语言驱动生图、编辑与批量探索");
            AddFeature(features, 0, 1, "02", "无限成果画布", "自动整理图片、容器与清晰来源关系");
            AddFeature(features, 1, 0, "03", "专业交付", "分层 PNG、透明素材与 PSD 导出");
            AddFeature(features, 1, 1, "04", "安全更新", "小版本无损更新，大版本保留用户数据");
            stack.Children.Add(features);
        }
        var releaseNotes = CreateReleaseNotesCard(_existing is null ? 96 : 188);
        releaseNotes.Margin = new Thickness(0, 12, 0, 0);
        stack.Children.Add(releaseNotes);
        SetPage("WELCOME", _existing is null ? "欢迎使用 naimage" : "更新或修复 naimage",
            _existing is null
                ? "现代 AI 图像工作台将在当前用户下安全部署，不会触碰你已有的项目文件。"
                : "安装器已识别现有版本。继续后将更新程序组件，画布、会话、设置和 FastMemory 保持不变。",
            stack);
        BackButton.Visibility = Visibility.Collapsed;
        SecondaryButton.Visibility = Visibility.Visible;
        SetButtonLabel(SecondaryButton, "退出");
        PrimaryButton.Visibility = Visibility.Visible;
        SetButtonLabel(PrimaryButton, "开始");
        PrimaryButton.IsEnabled = true;
        CloseEnabled = true;
        SetKeyboardButtons(PrimaryButton, SecondaryButton);
        FooterNote.Text = "官方安装包 · 完整性校验 · 默认保留用户数据";
    }

    private void ShowOptions()
    {
        _page = PageKind.Options;
        DetachFromLogicalParent(_pathBox);
        DetachFromLogicalParent(_desktopToggle);
        DetachFromLogicalParent(_startMenuToggle);
        DetachFromLogicalParent(_launchToggle);
        var stack = new StackPanel();
        if (_existing is not null)
        {
            var locked = StatusPill($"已安装 {_existing.Version} · 更新路径已锁定", BrandPalette.Blue);
            locked.Margin = new Thickness(0, 0, 0, 13);
            stack.Children.Add(locked);
            _pathBox.Text = _existing.InstallDirectory;
        }
        _pathBox.IsReadOnly = _existing is not null;
        _pathBox.IsTabStop = _existing is null;
        _pathBox.Opacity = _existing is null ? 1 : 0.78;
        stack.Children.Add(Text("安装位置", 11, BrandPalette.Muted, FontWeights.SemiBold));
        var pathGrid = new Grid();
        pathGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        pathGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var field = Card(_pathBox, new Thickness(14, 10, 14, 10));
        field.Margin = new Thickness(0, 7, _existing is null ? 10 : 0, 0);
        var browse = MakeButton("浏览", false);
        browse.Margin = new Thickness(0, 7, 0, 0);
        browse.Visibility = _existing is null ? Visibility.Visible : Visibility.Collapsed;
        browse.IsTabStop = _existing is null;
        browse.Click += (_, _) => BrowseFolder();
        Grid.SetColumn(field, 0);
        Grid.SetColumn(browse, 1);
        pathGrid.Children.Add(field);
        pathGrid.Children.Add(browse);
        stack.Children.Add(pathGrid);

        var toggles = new Grid { Margin = new Thickness(0, 15, 0, 0) };
        toggles.ColumnDefinitions.Add(new ColumnDefinition());
        toggles.ColumnDefinitions.Add(new ColumnDefinition());
        _desktopToggle.Margin = new Thickness(0, 0, 7, 0);
        _startMenuToggle.Margin = new Thickness(7, 0, 0, 0);
        Grid.SetColumn(_desktopToggle, 0);
        Grid.SetColumn(_startMenuToggle, 1);
        toggles.Children.Add(_desktopToggle);
        toggles.Children.Add(_startMenuToggle);
        stack.Children.Add(toggles);
        _launchToggle.Margin = new Thickness(0, 12, 0, 0);
        stack.Children.Add(_launchToggle);

        var safety = Text("项目与成果保存在独立用户数据目录。覆盖安装和默认卸载都不会删除这些内容。", 11.5, Color.FromRgb(160, 198, 194));
        var safetyCard = Card(safety, new Thickness(14, 12, 14, 12));
        safetyCard.BorderBrush = BrandPalette.Brush(Color.FromRgb(31, 101, 91));
        safetyCard.Margin = new Thickness(0, 15, 0, 0);
        stack.Children.Add(safetyCard);

        SetPage("SETUP", _existing is null ? "确认安装选项" : "确认更新选项",
            _existing is null
                ? "选择当前用户可写的安装位置和系统快捷入口。"
                : "为保证覆盖更新和失败回滚可靠，已安装版本必须沿用原安装位置。",
            stack);
        BackButton.Visibility = Visibility.Visible;
        SetButtonLabel(BackButton, "返回");
        SecondaryButton.Visibility = Visibility.Visible;
        SetButtonLabel(SecondaryButton, "取消");
        PrimaryButton.Visibility = Visibility.Visible;
        SetButtonLabel(PrimaryButton, _existing is null ? "安装" : "更新 / 修复");
        PrimaryButton.IsEnabled = true;
        CloseEnabled = true;
        SetKeyboardButtons(PrimaryButton, SecondaryButton);
        FooterNote.Text = "需要约 650 MB 可用空间";
    }

    private void ShowProgressPreview()
    {
        _progressBar.Value = 56;
        _progressStage.Text = "部署应用";
        _progressDetail.Text = "正在解压并校验程序文件";
        ShowProgress();
    }

    private void ShowProgress()
    {
        _page = PageKind.Progress;
        DetachFromLogicalParent(_progressStage);
        DetachFromLogicalParent(_progressDetail);
        DetachFromLogicalParent(_progressBar);
        var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        var orb = new Border
        {
            Width = 66,
            Height = 66,
            CornerRadius = new CornerRadius(22),
            Background = new LinearGradientBrush(BrandPalette.Mint, BrandPalette.Blue, 35),
            HorizontalAlignment = HorizontalAlignment.Left,
            Child = Text("ii", 24, BrandPalette.Ink, FontWeights.Bold),
            Padding = new Thickness(0, 15, 0, 0)
        };
        ((TextBlock)orb.Child).TextAlignment = TextAlignment.Center;
        stack.Children.Add(orb);
        _progressStage.Margin = new Thickness(0, 20, 0, 4);
        stack.Children.Add(_progressStage);
        stack.Children.Add(_progressDetail);
        _progressBar.Margin = new Thickness(0, 24, 0, 0);
        stack.Children.Add(_progressBar);
        var note = Text("安装内核在后台静默运行，不会出现旧式 Windows 向导。", 10.5, Color.FromRgb(102, 141, 146));
        note.Margin = new Thickness(0, 12, 0, 0);
        stack.Children.Add(note);
        SetPage("INSTALLING", _existing is null ? "正在安装 naimage" : "正在安全更新 naimage",
            "请保持此窗口开启。程序文件完成写入后会自动配置系统入口。", stack);
        BackButton.Visibility = Visibility.Collapsed;
        PrimaryButton.Visibility = Visibility.Collapsed;
        PrimaryButton.IsEnabled = false;
        SetButtonLabel(PrimaryButton, "处理中");
        SecondaryButton.Visibility = _existing is null ? Visibility.Visible : Visibility.Collapsed;
        SetButtonLabel(SecondaryButton, "安全取消");
        CloseEnabled = false;
        SetKeyboardButtons(null, _existing is null ? SecondaryButton : null);
        FooterNote.Text = _existing is null ? "取消后会自动撤销本次安装" : "升级提交阶段不可中断，以保护已有版本";
    }

    private void ShowComplete(bool wasUpgrade)
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
        var ready = Text(wasUpgrade ? "更新完成，创作环境已保持。" : "安装完成，可以开始创作了。", 17, BrandPalette.Text, FontWeights.SemiBold);
        ready.Margin = new Thickness(0, 20, 0, 8);
        stack.Children.Add(ready);
        stack.Children.Add(Text("登录账户后，Agent 会接手图像任务并将成果自动放入画布。", 12.5, BrandPalette.Muted));
        SetPage("READY", "naimage 已准备就绪", "所有程序组件与系统入口均已配置完成。", stack);
        BackButton.Visibility = Visibility.Collapsed;
        SecondaryButton.Visibility = Visibility.Collapsed;
        PrimaryButton.Visibility = Visibility.Visible;
        PrimaryButton.IsEnabled = true;
        SetButtonLabel(PrimaryButton, "完成");
        CloseEnabled = true;
        SetKeyboardButtons(PrimaryButton, null);
        FooterNote.Text = "默认保留项目、会话、设置与图片库";
    }

    private void ShowError(string message, string logPath)
    {
        ResultCode = 1;
        _page = PageKind.Error;
        DetachFromLogicalParent(_errorDetail);
        _errorDetail.Text = message;
        var stack = new StackPanel();
        stack.Children.Add(StatusPill("安装未完成", BrandPalette.Danger));
        var detailCard = Card(_errorDetail, new Thickness(16));
        detailCard.Margin = new Thickness(0, 15, 0, 0);
        detailCard.BorderBrush = BrandPalette.Brush(Color.FromRgb(104, 54, 60));
        stack.Children.Add(detailCard);
        var log = Text($"诊断日志：{logPath}", 10.5, Color.FromRgb(118, 150, 155));
        log.Margin = new Thickness(0, 12, 0, 0);
        stack.Children.Add(log);
        SetPage("ERROR", "未能完成安装", "程序文件已停止写入；全新安装会自动撤销已创建的组件。", stack);
        BackButton.Visibility = Visibility.Visible;
        SetButtonLabel(BackButton, "返回选项");
        SecondaryButton.Visibility = Visibility.Visible;
        SetButtonLabel(SecondaryButton, "退出");
        PrimaryButton.Visibility = Visibility.Visible;
        PrimaryButton.IsEnabled = true;
        SetButtonLabel(PrimaryButton, "重试");
        CloseEnabled = true;
        SetKeyboardButtons(PrimaryButton, SecondaryButton);
        FooterNote.Text = "如问题持续，请将诊断日志发送给支持人员";
    }

    private void HandleBack()
    {
        if (_page == PageKind.Error)
        {
            ShowOptions();
            return;
        }
        ShowWelcome();
    }

    private async Task HandlePrimaryAsync()
    {
        switch (_page)
        {
            case PageKind.Welcome:
                ShowOptions();
                break;
            case PageKind.Options:
            case PageKind.Error:
                await BeginInstallAsync();
                break;
            case PageKind.Complete:
                Close();
                break;
        }
    }

    private void HandleSecondary()
    {
        if (_page == PageKind.Progress && _existing is null)
        {
            _cancelFreshInstall = true;
            SecondaryButton.IsEnabled = false;
            _progressStage.Text = "正在安全撤销";
            _progressDetail.Text = "当前写入阶段完成后将自动移除本次安装";
            FooterNote.Text = "请稍候，避免留下不完整的程序文件";
            return;
        }
        Close();
    }

    private async Task BeginInstallAsync()
    {
        string installDirectory;
        try { installDirectory = _existing?.InstallDirectory ?? Path.GetFullPath(_pathBox.Text.Trim()); }
        catch { ShowError("安装路径无效，请返回并重新选择。", "尚未生成日志"); return; }

        _installing = true;
        _cancelFreshInstall = false;
        _progressBar.Value = 8;
        _progressStage.Text = "准备安装";
        _progressDetail.Text = "正在检查安装环境";
        ShowProgress();
        var progress = new Progress<InstallProgress>(value =>
        {
            _progressBar.Value = value.Percent;
            _progressStage.Text = value.Stage;
            _progressDetail.Text = value.Detail;
        });
        var options = InstallArguments.Parse(_args, installDirectory,
            _desktopToggle.IsChecked, _startMenuToggle.IsChecked, _launchToggle.IsChecked);
        var result = await InstallerEngine.InstallAsync(options, progress, CancellationToken.None);

        if (_cancelFreshInstall && result.Success)
        {
            _progressStage.Text = "正在撤销安装";
            _progressDetail.Text = "正在移除本次写入的程序组件";
            var rollbackCompleted = await RunInstalledUninstallerAsync(installDirectory);
            if (!rollbackCompleted)
            {
                ResultCode = 1;
                _installing = false;
                CloseEnabled = true;
                ShowError(
                    "安装已经完成，但自动撤销未能完整移除程序。请关闭 naimage，并从 Windows“已安装的应用”再次卸载。",
                    Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "naimage",
                        "installer-logs"));
                return;
            }
            ResultCode = 1223;
            _installing = false;
            CloseEnabled = true;
            Close();
            return;
        }

        _installing = false;
        ResultCode = result.ExitCode;
        if (result.Success) ShowComplete(_existing is not null);
        else if (result.Cancelled) Close();
        else ShowError(result.Message, result.LogPath);
    }

    private static async Task<bool> RunInstalledUninstallerAsync(string installDirectory)
    {
        var installedExecutable = Path.Combine(installDirectory, "naimage.exe");
        var timeout = ProcessWatchdog.ResolveTimeout(
            "NAIMAGE_INSTALLER_DIAGNOSTIC_CANCEL_ROLLBACK_TIMEOUT_MS",
            TimeSpan.FromMinutes(5));
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var wrapper = Path.Combine(installDirectory, "naimage-uninstaller.exe");
            var core = Path.Combine(installDirectory, "Uninstall naimage.exe");
            var executable = File.Exists(wrapper) ? wrapper : core;
            if (!File.Exists(executable)) break;
            var arguments = new List<string> { "/S" };
            if (string.Equals(executable, core, StringComparison.OrdinalIgnoreCase))
            {
                arguments.Add("/currentuser");
                arguments.Add($"_?={installDirectory}");
            }
            var start = new ProcessStartInfo(executable)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                Arguments = WindowsCommandLine.Join(arguments.ToArray())
            };
            using var process = Process.Start(start);
            if (process is null) continue;
            var completed = await ProcessWatchdog.WaitForExitAsync(
                process,
                timeout,
                TimeSpan.FromMilliseconds(250),
                CancellationToken.None);
            if (completed && process.ExitCode == 0) break;
        }
        for (var retry = 0; retry < 80 && File.Exists(installedExecutable); retry++)
            await Task.Delay(250);
        return !File.Exists(installedExecutable);
    }

    private void BrowseFolder()
    {
        if (_existing is not null) return;
        if (ModernFolderPicker.TryPick(this, "选择 naimage 安装位置", _pathBox.Text, out var selectedPath))
        {
            _pathBox.Text = string.Equals(Path.GetFileName(selectedPath), "naimage", StringComparison.OrdinalIgnoreCase)
                ? selectedPath
                : Path.Combine(selectedPath, "naimage");
        }
    }

    private static Border CreateReleaseNotesCard(double scrollHeight)
    {
        var version = DisplayVersion();
        var notes = InstallerReleaseNotes.ForVersion(version);
        var root = new StackPanel();
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var title = Text($"{version} 发布说明", 11.5, BrandPalette.Text, FontWeights.SemiBold);
        var hint = Text("滚轮 / 方向键查看", 9.5, BrandPalette.Muted, FontWeights.SemiBold);
        Grid.SetColumn(title, 0);
        Grid.SetColumn(hint, 1);
        header.Children.Add(title);
        header.Children.Add(hint);
        root.Children.Add(header);

        var noteStack = new StackPanel { Margin = new Thickness(0, 7, 0, 0) };
        if (notes.Count == 0)
        {
            noteStack.Children.Add(Text("本版本包含稳定性、安装体验与创作工作流更新。", 10.5, BrandPalette.Muted));
        }
        else
        {
            foreach (var note in notes)
            {
                var row = Text("•  " + note, 10.5, Color.FromRgb(169, 204, 201));
                row.Margin = new Thickness(0, 0, 0, 7);
                noteStack.Children.Add(row);
            }
        }
        root.Children.Add(MakeScrollArea(noteStack, scrollHeight, $"naimage {version} 发布说明"));
        return Card(root, new Thickness(14, 12, 14, 12));
    }

    private static void AddFeature(Grid grid, int row, int column, string number, string title, string detail)
    {
        var panel = new StackPanel();
        panel.Children.Add(Text(number, 10, BrandPalette.Mint, FontWeights.Bold));
        var titleText = Text(title, 12.5, BrandPalette.Text, FontWeights.SemiBold);
        titleText.Margin = new Thickness(0, 6, 0, 3);
        panel.Children.Add(titleText);
        panel.Children.Add(Text(detail, 10.5, BrandPalette.Muted));
        var card = Card(panel, new Thickness(14));
        card.Margin = new Thickness(column == 0 ? 0 : 6, row == 0 ? 0 : 12, column == 0 ? 6 : 0, 0);
        Grid.SetRow(card, row);
        Grid.SetColumn(card, column);
        grid.Children.Add(card);
    }

    internal bool VerifyPageReuseForDiagnostics()
    {
        ShowOptions();
        ShowError("诊断错误", "诊断日志");
        ShowOptions();
        ShowProgressPreview();
        ShowError("再次诊断错误", "诊断日志");
        ShowProgressPreview();
        return _page == PageKind.Progress;
    }
}

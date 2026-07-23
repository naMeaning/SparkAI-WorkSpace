using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace Naimage.WindowsInstaller;

/// <summary>
/// Uses the modern Explorer IFileDialog in folder-picking mode. This avoids
/// the legacy WinForms FolderBrowserDialog tree while keeping the selection
/// inside the normal Windows shell security boundary.
/// </summary>
internal static class ModernFolderPicker
{
    private const int CancelledHResult = unchecked((int)0x800704C7);
    private const FileOpenOptions FolderOptions =
        FileOpenOptions.PickFolders |
        FileOpenOptions.ForceFileSystem |
        FileOpenOptions.PathMustExist |
        FileOpenOptions.NoChangeDirectory |
        FileOpenOptions.DoNotAddToRecent;

    internal static bool TryPick(Window owner, string title, string initialPath, out string selectedPath)
    {
        selectedPath = "";
        IFileOpenDialog? dialog = null;
        IShellItem? initialItem = null;
        IShellItem? resultItem = null;
        try
        {
            dialog = (IFileOpenDialog)new FileOpenDialogComObject();
            dialog.GetOptions(out var options);
            dialog.SetOptions(options | FolderOptions);
            dialog.SetTitle(title);
            dialog.SetOkButtonLabel("选择此文件夹");

            var existingDirectory = FindExistingDirectory(initialPath);
            if (!string.IsNullOrWhiteSpace(existingDirectory) &&
                NativeMethods.SHCreateItemFromParsingName(existingDirectory!, IntPtr.Zero,
                    typeof(IShellItem).GUID, out initialItem) == 0 && initialItem is not null)
            {
                dialog.SetFolder(initialItem);
            }

            var result = dialog.Show(new WindowInteropHelper(owner).Handle);
            if (result == CancelledHResult) return false;
            Marshal.ThrowExceptionForHR(result);

            dialog.GetResult(out resultItem);
            resultItem.GetDisplayName(ShellDisplayName.FileSystemPath, out var pointer);
            try
            {
                selectedPath = Marshal.PtrToStringUni(pointer) ?? "";
            }
            finally
            {
                Marshal.FreeCoTaskMem(pointer);
            }
            return !string.IsNullOrWhiteSpace(selectedPath);
        }
        finally
        {
            ReleaseCom(resultItem);
            ReleaseCom(initialItem);
            ReleaseCom(dialog);
        }
    }

    internal static bool TryProbe(out string error)
    {
        error = "";
        IFileOpenDialog? dialog = null;
        try
        {
            dialog = (IFileOpenDialog)new FileOpenDialogComObject();
            dialog.GetOptions(out var options);
            dialog.SetOptions(options | FolderOptions);
            dialog.GetOptions(out var configured);
            return (configured & FolderOptions) == FolderOptions;
        }
        catch (Exception exception)
        {
            error = exception.GetType().Name + ": " + exception.Message;
            return false;
        }
        finally
        {
            ReleaseCom(dialog);
        }
    }

    private static string? FindExistingDirectory(string path)
    {
        string? candidate;
        try { candidate = Path.GetFullPath(path); }
        catch { candidate = null; }
        while (!string.IsNullOrWhiteSpace(candidate) && !Directory.Exists(candidate))
        {
            var parent = Path.GetDirectoryName(candidate);
            if (string.IsNullOrWhiteSpace(parent) || string.Equals(parent, candidate, StringComparison.OrdinalIgnoreCase))
                return null;
            candidate = parent;
        }
        return candidate;
    }

    private static void ReleaseCom(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value);
    }

    [Flags]
    private enum FileOpenOptions : uint
    {
        PickFolders = 0x00000020,
        ForceFileSystem = 0x00000040,
        NoChangeDirectory = 0x00000008,
        PathMustExist = 0x00000800,
        DoNotAddToRecent = 0x02000000
    }

    private enum ShellDisplayName : uint
    {
        FileSystemPath = 0x80058000
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct FilterSpec
    {
        internal string Name;
        internal string Spec;
    }

    [ComImport]
    [Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    private class FileOpenDialogComObject { }

    [ComImport]
    [Guid("D57C7288-D4AD-4768-BE02-9D969532D960")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes(uint count, [MarshalAs(UnmanagedType.LPArray)] FilterSpec[] filterSpec);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(FileOpenOptions options);
        void GetOptions(out FileOpenOptions options);
        void SetDefaultFolder(IShellItem shellItem);
        void SetFolder(IShellItem shellItem);
        void GetFolder(out IShellItem shellItem);
        void GetCurrentSelection(out IShellItem shellItem);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem shellItem);
        void AddPlace(IShellItem shellItem, int alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
        void Close(int result);
        void SetClientGuid(ref Guid clientGuid);
        void ClearClientData();
        void SetFilter(IntPtr filter);
        void GetResults(out IntPtr shellItems);
        void GetSelectedItems(out IntPtr shellItems);
    }

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr bindContext, ref Guid handler, ref Guid interfaceId, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(ShellDisplayName displayName, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem shellItem, uint hint, out int order);
    }

    private static class NativeMethods
    {
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
        internal static extern int SHCreateItemFromParsingName(
            [MarshalAs(UnmanagedType.LPWStr)] string path,
            IntPtr bindContext,
            [MarshalAs(UnmanagedType.LPStruct)] Guid interfaceId,
            out IShellItem shellItem);
    }
}

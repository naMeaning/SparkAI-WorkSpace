using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;

namespace Iiimage.WindowsInstaller;

internal static class InstallerReleaseNotes
{
    private const string ResourceName = "iiimage.release-notes.json";

    internal static IReadOnlyList<string> ForVersion(string version)
    {
        try
        {
            using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName);
            if (stream is null) return Array.Empty<string>();
            using var reader = new StreamReader(stream);
            var releases = new JavaScriptSerializer().Deserialize<Dictionary<string, string[]>>(reader.ReadToEnd());
            return releases is not null && releases.TryGetValue(version, out var notes) && notes is not null
                ? notes
                : Array.Empty<string>();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }
}

# Walker: legge tutti i dischi fissi e scrive su file (JSON Lines) solo cio' che interessa all'inventario.
# E' in C# perche' .NET restituisce le dimensioni insieme ai nomi: su oltre un milione di file e' molto piu' veloce.
# Sola lettura. Gira a priorita' bassa per non disturbare il lavoro in corso.
param(
  [Parameter(Mandatory=$true)][string]$Out,
  [string]$Watched = ''
)
$ErrorActionPreference = 'Stop'
try { (Get-Process -Id $PID).PriorityClass = 'BelowNormal' } catch {}

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;

public static class InvWalker {
  static StreamWriter w;
  static long files = 0, dirs = 0, denied = 0;
  static HashSet<string> watched = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

  static readonly HashSet<string> SkipNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
    "node_modules", ".git", "$Recycle.Bin", "System Volume Information", "WindowsApps", "__pycache__",
    "Config.Msi", "Recovery", "PerfLogs", ".trash", "$WinREAgent", "$SysReset"
  };
  static readonly HashSet<string> ModelExt = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
    ".gguf", ".ggml", ".safetensors", ".ckpt", ".pt", ".pth", ".onnx", ".tflite", ".nemo", ".bin"
  };
  static readonly HashSet<string> ExeNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
    "llama-server.exe", "llama-cli.exe", "whisper-cli.exe", "whisper-server.exe", "ollama.exe", "lms.exe",
    "LM Studio.exe", "koboldcpp.exe", "audiocpp_server.exe", "jan.exe", "AnythingLLM.exe", "Msty.exe", "Pinokio.exe"
  };

  static void Str(StringBuilder b, string s) {
    b.Append('"');
    foreach (char c in s) {
      if (c == '\\') b.Append("\\\\");
      else if (c == '"') b.Append("\\\"");
      else if (c < 32) b.Append(' ');
      else b.Append(c);
    }
    b.Append('"');
  }
  static void Emit(string kind, string path, long size, DateTime? mod) {
    var b = new StringBuilder();
    b.Append("{\"k\":\"").Append(kind).Append("\",\"p\":");
    Str(b, path);
    b.Append(",\"s\":").Append(size);
    if (mod.HasValue) b.Append(",\"m\":\"").Append(mod.Value.ToUniversalTime().ToString("o")).Append('"');
    b.Append('}');
    w.WriteLine(b.ToString());
  }

  static long Walk(DirectoryInfo d, bool inHf) {
    dirs++;
    long total = 0;
    bool isVenv = false;
    bool isComfy = false;
    bool hf =d.Name.StartsWith("models--", StringComparison.OrdinalIgnoreCase);
    var subdirs = new List<DirectoryInfo>();
    try {
      foreach (var e in d.EnumerateFileSystemInfos()) {
        if ((e.Attributes & FileAttributes.ReparsePoint) != 0) continue;
        var di = e as DirectoryInfo;
        if (di != null) {
          if (!SkipNames.Contains(di.Name)) subdirs.Add(di);
          continue;
        }
        var f = (FileInfo)e;
        files++;
        long len = f.Length;
        total += len;
        string name = f.Name;
        if (name.Equals("pyvenv.cfg", StringComparison.OrdinalIgnoreCase)) isVenv = true;
        else if (name.Equals("SKILL.md", StringComparison.OrdinalIgnoreCase)) Emit("skill", f.FullName, len, null);
        else if (name.Equals(".mcp.json", StringComparison.OrdinalIgnoreCase) || name.Equals("claude_desktop_config.json", StringComparison.OrdinalIgnoreCase)) Emit("mcp", f.FullName, len, null);
        else if (name.Equals("comfyui_version.py", StringComparison.OrdinalIgnoreCase)) isComfy = true;
        else if (name.Equals("package.json", StringComparison.OrdinalIgnoreCase) && len < 200000 && f.FullName.IndexOf("\\Documents\\", StringComparison.OrdinalIgnoreCase) > 0) Emit("pkg", f.FullName, len, null);
        else if (ExeNames.Contains(name)) Emit("exe", f.FullName, len, f.LastWriteTime);
        else if (!inHf && !hf && len >= 50L * 1024 * 1024 && ModelExt.Contains(f.Extension)) Emit("model", f.FullName, len, f.LastWriteTime);
      }
    } catch (UnauthorizedAccessException) { denied++; }
    catch (PathTooLongException) { denied++; }
    catch (IOException) { denied++; }

    foreach (var s in subdirs) {
      try { total += Walk(s, inHf || hf); }
      catch (UnauthorizedAccessException) { denied++; }
      catch (PathTooLongException) { denied++; }
      catch (IOException) { denied++; }
    }
    if (hf && !inHf) Emit("hf", d.FullName, total, d.LastWriteTime);
    if (isVenv) Emit("venv", d.FullName, total, null);
    if (isComfy) Emit("comfy", d.FullName, total, null);
    if (watched.Contains(d.FullName)) Emit("dir", d.FullName, total, null);
    return total;
  }

  public static void Run(string output, string watchedList) {
    foreach (var p in watchedList.Split('|')) if (p.Length > 0) watched.Add(p.TrimEnd('\\'));
    using (w = new StreamWriter(output, false, new UTF8Encoding(false))) {
      var drives = new List<string>();
      foreach (var di in DriveInfo.GetDrives()) {
        if (di.DriveType != DriveType.Fixed || !di.IsReady) continue;
        drives.Add(di.Name);
        var root = new DirectoryInfo(di.Name);
        foreach (var e in root.EnumerateDirectories()) {
          if ((e.Attributes & FileAttributes.ReparsePoint) != 0) continue;
          if (SkipNames.Contains(e.Name)) continue;
          if (e.Name.Equals("Windows", StringComparison.OrdinalIgnoreCase)) continue;
          try { Walk(e, false); } catch (Exception) { denied++; }
        }
      }
      var b = new StringBuilder("{\"k\":\"done\",\"files\":");
      b.Append(files).Append(",\"dirs\":").Append(dirs).Append(",\"denied\":").Append(denied).Append(",\"drives\":\"");
      b.Append(string.Join(" ", drives).Replace("\\", "")).Append("\"}");
      w.WriteLine(b.ToString());
    }
  }
}
'@

[InvWalker]::Run($Out, $Watched)

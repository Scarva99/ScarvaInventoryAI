# Raccoglie in un colpo solo: hardware, programmi installati, porte in ascolto e motori AI in esecuzione.
# Stampa un unico JSON. Sola lettura. Delle righe di comando dei processi non viene salvato nulla.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$cs = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem

$disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
  [pscustomobject]@{ name = $_.DeviceID; size = [double]$_.Size; free = [double]$_.FreeSpace; label = $_.VolumeName }
})

$gpus = @()
$nvOut = & nvidia-smi --query-gpu=name,memory.total,memory.used,utilization.gpu,driver_version --format=csv,noheader,nounits 2>$null
foreach ($line in @($nvOut)) {
  if (-not $line) { continue }
  $p = $line.Split(',') | ForEach-Object { $_.Trim() }
  $gpus += [pscustomobject]@{ name = $p[0]; vramMiB = [int]$p[1]; usedMiB = [int]$p[2]; util = [int]$p[3]; driver = $p[4] }
}
$cuda = ''
$head = (& nvidia-smi 2>$null | Select-Object -First 4) -join ' '
if ($head -match 'CUDA (?:UMD )?Version:\s*([\d.]+)') { $cuda = $Matches[1] }

$regPaths = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$apps = @(Get-ItemProperty $regPaths | Where-Object { $_.DisplayName -and -not $_.SystemComponent } |
  Sort-Object DisplayName -Unique | ForEach-Object {
    [pscustomobject]@{ name = [string]$_.DisplayName; version = [string]$_.DisplayVersion; publisher = [string]$_.Publisher; location = [string]$_.InstallLocation; kb = [double]$_.EstimatedSize }
  })

$appx = @(Get-AppxPackage | Where-Object { $_.Name -match 'claude|anthropic|codex|openai|chatgpt|copilot|gemini|perplexity' -and -not $_.IsFramework } | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.Name; version = [string]$_.Version; publisher = [string]$_.PublisherId; location = [string]$_.InstallLocation }
})

$wsl = @()
$wslOut = (& wsl.exe --list --quiet 2>$null) -join "`n"
if ($wslOut) { $wsl = @(($wslOut -replace "`0", '') -split "`r?`n" | Where-Object { $_.Trim() -and $_ -notmatch 'wsl|Windows Subsystem' }) }

$ports = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 1234,5000,7860,8000,8080,8188,8888,11434 } | ForEach-Object {
  [pscustomobject]@{ port = [int]$_.LocalPort; process = [string](Get-Process -Id $_.OwningProcess).ProcessName }
})

# Si guarda il programma realmente eseguito, non il testo del comando: la riga di comando puo' solo
# citare un percorso (lo fa anche la scansione del disco con .unsloth) senza che il motore sia acceso.
$patterns = @{
  'ComfyUI' = 'ComfyUI'
  'Unsloth Studio' = 'unsloth'
  'llama.cpp' = 'llama-server|llama-cli'
  'whisper.cpp' = 'whisper-server|whisper-cli'
  'Ollama' = 'ollama'
  'LM Studio' = 'LM Studio'
  'VoiceStudio' = 'VoiceStudio|OmniVoice'
}
$running = @()
$procs = @(Get-CimInstance Win32_Process | Select-Object Name, ExecutablePath)
foreach ($k in $patterns.Keys) {
  $hit = $procs | Where-Object { ($_.Name + ' ' + $_.ExecutablePath) -match $patterns[$k] } | Select-Object -First 1
  if ($hit) { $running += $k }
}

[pscustomobject]@{
  computer = $env:COMPUTERNAME
  cpu = [string]$cpu.Name; cores = [int]$cpu.NumberOfCores; threads = [int]$cpu.NumberOfLogicalProcessors
  ramGB = [math]::Round([double]$cs.TotalPhysicalMemory / 1GB)
  os = [string]$os.Caption; build = [string]$os.BuildNumber
  disks = $disks; gpus = $gpus; cuda = $cuda
  apps = $apps; appx = $appx; wsl = $wsl; ports = $ports; running = $running
} | ConvertTo-Json -Compress -Depth 5

# Creates a Windows desktop shortcut for the WebPi desktop application.
#
#   powershell -ExecutionPolicy Bypass -File desktop\windows-shortcut.ps1 `
#     -TargetPath .\release\win-unpacked\WebPi.exe
#
# The target may be the unpacked build, the installed executable, or the
# single-file portable .exe. The unpacked build is the fastest to launch: the
# portable one unpacks its whole tree to a temporary folder on every start.
param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath,

    [string]$ShortcutName = "WebPi",

    # Defaults to the current user's Desktop folder.
    [string]$Desktop = [Environment]::GetFolderPath("Desktop")
)

$ErrorActionPreference = "Stop"

$target = (Resolve-Path -LiteralPath $TargetPath).Path
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    throw "Not a file: $target"
}

$linkPath = Join-Path $Desktop "$ShortcutName.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = Split-Path -Parent $target
# The executable carries the WebPi icon, so the shortcut inherits it.
$shortcut.IconLocation = "$target,0"
$shortcut.Description = "WebPi - local browser UI for the pi coding agent"
$shortcut.Save()

Write-Output "Shortcut: $linkPath"
Write-Output "Target:   $target"

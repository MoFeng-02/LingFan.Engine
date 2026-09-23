# pack-template.ps1 — 把脚手架工程目录打包为 ZIP（排除依赖/产物/版本库/运行期存档）
# 跨平台：PowerShell 7（pwsh）在 Windows / Linux / macOS 均可用。
# 用法: pwsh -File pack-template.ps1 -SourceDir "./__PROJECT__" -OutputFile "./__PROJECT__.zip"
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDir,

    [Parameter(Mandatory = $true)]
    [string]$OutputFile
)

$ErrorActionPreference = 'Stop'

# 路径分隔符归一（调用方可能传入反斜杠）
$SourceDir = $SourceDir -replace '\\', '/'
$OutputFile = $OutputFile -replace '\\', '/'

# 排除目录：依赖、构建产物、版本库、运行期存档
$excludeDirs = @('node_modules', 'dist', '.git', 'Saves')

$sourcePath = Resolve-Path $SourceDir
$sourceRoot = $sourcePath.Path

$outputFull = [System.IO.Path]::GetFullPath($OutputFile)
$outputDir = Split-Path $outputFull -Parent
if ($outputDir -and -not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}
if (Test-Path $outputFull) { Remove-Item $outputFull -Force }

$tempBase = if ($env:TEMP) { $env:TEMP }
            elseif ($env:TMPDIR) { $env:TMPDIR }
            else { [System.IO.Path]::GetTempPath() }
$tempDir = Join-Path $tempBase "lingfan_template_$(Get-Random)"

try {
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    Get-ChildItem -Path $sourceRoot -Recurse -Force | ForEach-Object {
        $relative = $_.FullName.Substring($sourceRoot.Length).TrimStart('\', '/')
        if (-not $relative) { return }

        $segments = $relative -split '[\\/]'
        foreach ($excluded in $excludeDirs) {
            if ($segments -contains $excluded) { return }
        }

        $dest = Join-Path $tempDir $relative
        if ($_.PSIsContainer) {
            New-Item -ItemType Directory -Path $dest -Force | Out-Null
        } else {
            $destParent = Split-Path $dest -Parent
            if (-not (Test-Path $destParent)) {
                New-Item -ItemType Directory -Path $destParent -Force | Out-Null
            }
            Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
        }
    }

    Compress-Archive -Path (Join-Path $tempDir '*') -DestinationPath $outputFull -Force
    Write-Host "已打包: $outputFull"
}
finally {
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
}

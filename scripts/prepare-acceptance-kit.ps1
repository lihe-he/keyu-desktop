[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$InstallerPath,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-CheckedAbsolutePath {
    param([string]$CandidatePath)

    if ($CandidatePath -notmatch '^[A-Za-z]:[\\/]') {
        throw '请传入本机盘符开头的绝对路径。'
    }
    $pathRoot = [System.IO.Path]::GetPathRoot($CandidatePath)
    foreach ($segment in $CandidatePath.Substring($pathRoot.Length).Split([char[]]'\/', [System.StringSplitOptions]::RemoveEmptyEntries)) {
        if ($segment -in @('.', '..')) { continue }
        if ($segment.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0 -or
            $segment.EndsWith(' ') -or $segment.EndsWith('.') -or
            $segment -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
            throw '路径含非法、特殊设备或歧义名称。'
        }
    }
    return [System.IO.Path]::GetFullPath($CandidatePath)
}

function Assert-WithinRelease {
    param([string]$CandidatePath, [string]$ReleaseRoot)

    $prefix = $ReleaseRoot.TrimEnd([char[]]'\/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $CandidatePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw '安装包与验收目标必须位于本项目 release 目录内；目标不能是 release 根目录。'
    }
}

function Assert-NoReparsePoints {
    param([string]$CandidatePath)

    $pathRoot = [System.IO.Path]::GetPathRoot($CandidatePath)
    $cursor = $pathRoot
    $segments = @('') + @($CandidatePath.Substring($pathRoot.Length).Split([char[]]'\/', [System.StringSplitOptions]::RemoveEmptyEntries))
    foreach ($segment in $segments) {
        if ($segment) { $cursor = Join-Path -Path $cursor -ChildPath $segment }
        try {
            $entry = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
        } catch [System.Management.Automation.ItemNotFoundException] {
            # New destination ancestors may not yet exist; no later entry can exist.
            break
        }
        if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw '拒绝符号链接、目录联接及其他重解析点。'
        }
    }
}

function Assert-PathAbsent {
    param([string]$CandidatePath)

    try {
        $null = Get-Item -LiteralPath $CandidatePath -Force -ErrorAction Stop
    } catch [System.Management.Automation.ItemNotFoundException] {
        return
    }
    throw '目标目录或附件已存在，请使用新的验收目录；不会覆盖它。'
}

$kitProjectRoot = Resolve-CheckedAbsolutePath (Join-Path -Path $PSScriptRoot -ChildPath '..')
$kitReleaseRoot = Resolve-CheckedAbsolutePath (Join-Path -Path $kitProjectRoot -ChildPath 'release')
$kitInstaller = Resolve-CheckedAbsolutePath $InstallerPath
$kitOutput = Resolve-CheckedAbsolutePath $OutputDirectory
$kitManifest = Join-Path -Path $kitProjectRoot -ChildPath 'package.json'
$kitGuide = Join-Path -Path $kitProjectRoot -ChildPath 'docs\干净Windows验收.md'

Assert-WithinRelease $kitInstaller $kitReleaseRoot
Assert-WithinRelease $kitOutput $kitReleaseRoot
foreach ($kitPath in @($kitProjectRoot, $kitReleaseRoot, $kitInstaller, $kitOutput, $kitManifest, $kitGuide)) {
    Assert-NoReparsePoints $kitPath
}
if (-not (Get-Item -LiteralPath $kitReleaseRoot -Force).PSIsContainer) {
    throw '本项目 release 不是目录。'
}
Assert-PathAbsent $kitOutput
$kitInstallerEntry = Get-Item -LiteralPath $kitInstaller -Force
if ($kitInstallerEntry.PSIsContainer) { throw '安装包必须是一个文件。' }
$kitVersion = (Get-Content -LiteralPath $kitManifest -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($kitVersion -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw '项目版本号无效。' }
$kitInstallerName = 'CampusCourseDesktop-Setup-' + $kitVersion + '-x64.exe'
if ($kitInstallerEntry.Name -cne $kitInstallerName) {
    throw '传入文件名不匹配当前项目版本的 x64 NSIS 安装包。'
}
if ((Get-Item -LiteralPath $kitGuide -Force).PSIsContainer) { throw '验收说明必须是文件。' }
$kitSourceHash = (Get-FileHash -LiteralPath $kitInstaller -Algorithm SHA256).Hash.ToLowerInvariant()

# New-Item has no LiteralPath parameter. This absolute path was checked for
# containment, special names and reparse points, and must not already exist.
$null = New-Item -Path $kitOutput -ItemType Directory -ErrorAction Stop
Assert-NoReparsePoints $kitOutput
$kitCopiedInstaller = Join-Path -Path $kitOutput -ChildPath $kitInstallerName
$kitCopiedGuide = Join-Path -Path $kitOutput -ChildPath '干净Windows验收.md'
$kitSums = Join-Path -Path $kitOutput -ChildPath 'SHA256SUMS.txt'
$kitReadme = Join-Path -Path $kitOutput -ChildPath '验收包说明.md'
foreach ($kitAttachment in @($kitCopiedInstaller, $kitCopiedGuide, $kitSums, $kitReadme)) {
    Assert-PathAbsent $kitAttachment
}
Copy-Item -LiteralPath $kitInstaller -Destination $kitCopiedInstaller -ErrorAction Stop
Copy-Item -LiteralPath $kitGuide -Destination $kitCopiedGuide -ErrorAction Stop
$kitCopiedHash = (Get-FileHash -LiteralPath $kitCopiedInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
if ($kitCopiedHash -cne $kitSourceHash) { throw '复制后的安装包摘要不一致；目录保留，未清理或搬移。' }
Set-Content -LiteralPath $kitSums -Value ($kitCopiedHash + '  ' + $kitInstallerName) -Encoding ASCII
$kitReadmeText = @"
# 网课助手 $kitVersion · 干净 Windows 验收材料

- 当前候选安装包：$kitInstallerName
- SHA-256：$kitCopiedHash
- 人工步骤与事实记录：干净Windows验收.md

将整个目录复制到专用的干净 Windows 10 / 11 x64 测试环境，先核对摘要，再执行说明中的人工验收。测试会话使用固定 UUID；不登录真实账号，也不使用日常安装或日常数据目录。

这只是材料准备：脚本只复制传入文件并核对复制摘要，没有验证文件是否可安装，没有安装、卸载或启动程序，没有生成 passed 报告，也不能替代 install-smoke 或真实课程验收证据。0.1.4 升级起点安装包需在测试环境另从项目官方历史 Release 取得并核对其已发布摘要。

如果准备失败，现有及已创建目录保持原状；请核对后选择新的输出目录，不要覆盖已有附件。
"@
Set-Content -LiteralPath $kitReadme -Value $kitReadmeText -Encoding UTF8
Write-Output ([pscustomobject]@{
    Status = 'materials-prepared'
    Version = $kitVersion
    Directory = $kitOutput
    InstallerSha256 = $kitCopiedHash
    Files = @($kitInstallerName, 'SHA256SUMS.txt', '干净Windows验收.md', '验收包说明.md')
})

# 重新打包并安装 code-tutor-bridge 到 DSH 的 desktop profile。
# 参考 dsh-pet-balance-feeder/install.ps1 的同一套约定：
#   打包输出放 ASCII 路径（C:\ProgramData\dsh-plugins），避免 file: 参数中文乱码。
$ErrorActionPreference = 'Stop'

$src = $PSScriptRoot
$stage = 'C:\ProgramData\dsh-plugins'
$cli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
$profile = 'desktop'
$name = 'code-tutor-bridge'

if (-not (Test-Path $cli)) { throw "找不到 dsh CLI：$cli" }
if (-not (Test-Path $stage)) { New-Item -ItemType Directory -Force -Path $stage | Out-Null }

# npm pack 需要包名能被 npm 接受：@local/ scope 私有包直接 pack 目录
Push-Location $src
try {
  $out = npm pack --pack-destination $stage 2>&1
} finally {
  Pop-Location
}
$tgzName = ($out | Where-Object { $_ -like '*.tgz' } | Select-Object -Last 1).ToString().Trim()
$tgz = Join-Path $stage $tgzName
Write-Host "打包完成：$tgz"

& $cli plugin --profile $profile remove $name 2>&1 | Select-Object -Last 1
& $cli plugin --profile $profile add "file:$tgz" 2>&1 | Select-Object -Last 1

Write-Host ''
Write-Host '已安装 code-tutor-bridge。请重启 DSH 桌面应用让新代码生效。'

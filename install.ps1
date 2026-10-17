<#
.SYNOPSIS
  Code Tutor 一键安装脚本（DSH 用户）
.DESCRIPTION
  从 GitHub 仓库拉取源码，安装 DSH 桥接插件到 desktop profile，
  并初始化悬浮窗目录（提示用户放置 Electron 运行时）。
  用法（在任意 PowerShell 里执行）：
    irm https://raw.githubusercontent.com/<user>/code-tutor/main/install.ps1 | iex
  或克隆仓库后：
    .\install.ps1
#>
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = 'https://github.com/lqi02965-boop/code-tutor'   # ← 发布时替换为真实仓库地址
$branch = 'main'
$installRoot = Join-Path $env:USERPROFILE 'code-tutor'

Write-Host '=== Code Tutor 一键安装 ===' -ForegroundColor Cyan

# 1. 获取源码（已克隆则 git pull，否则 clone）
$src = Join-Path $installRoot 'code-tutor-src'
if (Test-Path (Join-Path $src '.git')) {
  Write-Host "[1/4] 更新已有源码 $src"
  git -C $src fetch --depth 1
  git -C $src reset --hard origin/$branch
} else {
  Write-Host "[1/4] 克隆仓库到 $src"
  git clone --depth 1 $repo $src
  if ($LASTEXITCODE -ne 0) { throw 'git clone 失败：请确认已安装 git 且网络可达 GitHub' }
}

# 2. 安装 DSH 桥接插件
$cli = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path $cli)) {
  Write-Host '[2/4] 未检测到 DSH，跳过桥接插件安装（悬浮窗仍可用自定义 LLM 后端）' -ForegroundColor Yellow
} else {
  Write-Host '[2/4] 安装 DSH 桥接插件...'
  $bridgeSrc = Join-Path $src 'dsh-code-tutor-bridge'
  $stage = 'C:\ProgramData\dsh-plugins'
  if (-not (Test-Path $stage)) { New-Item -ItemType Directory -Force -Path $stage | Out-Null }
  Push-Location $bridgeSrc
  try { npm pack --pack-destination $stage 2>&1 | Out-Null } finally { Pop-Location }
  $tgz = Get-ChildItem $stage -Filter 'local-code-tutor-bridge-*.tgz' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  & $cli plugin --profile desktop remove '@local/code-tutor-bridge' 2>&1 | Out-Null
  & $cli plugin --profile desktop add "file:$($tgz.FullName)" 2>&1 | Select-Object -Last 1
  Write-Host '      桥接插件已安装（DSH 需重启生效）'
}

# 3. 初始化悬浮窗目录
Write-Host '[3/4] 初始化悬浮窗目录...'
$winDir = Join-Path $installRoot 'code-tutor'
New-Item -ItemType Directory -Force -Path $winDir | Out-Null
foreach ($f in 'main.js', 'preload.js', 'index.html', '_launch_task.bat', '启动悬浮窗.cmd', 'gen-tray-icon.js') {
  Copy-Item (Join-Path $src "code-tutor\$f") $winDir -Force
}
# 打补丁：把源码里的演示路径替换成用户实际安装路径（悬浮窗自身路径）
$mainJs = Join-Path $winDir 'main.js'
$src2 = [System.IO.File]::ReadAllText($mainJs)
$src2 = $src2.Replace('D:\办公任务\code-tutor', $winDir)
# 源码里的 aux_files 演示路径 → 安装目录下的 aux_files（用户自行放参考资料）
$src2 = $src2.Replace('D:\办公任务\aux_files', (Join-Path $installRoot 'aux_files'))
[System.IO.File]::WriteAllText($mainJs, $src2, (New-Object System.Text.UTF8Encoding($false)))
New-Item -ItemType Directory -Force -Path (Join-Path $installRoot 'aux_files\context') | Out-Null

# 4. Electron 运行时
Write-Host '[4/4] 检查 Electron 运行时...'
if (Test-Path (Join-Path $winDir 'electron.exe')) {
  Write-Host '      已存在，跳过'
} else {
  Write-Host '      未找到 electron.exe。请任选其一：' -ForegroundColor Yellow
  Write-Host '      a) 从 https://github.com/electron/electron/releases 下载对应版本 zip，解压到：' -ForegroundColor Yellow
  Write-Host "         $winDir"
  Write-Host '      b) 或 npm i electron 后从 node_modules\electron\dist 复制运行时文件'
  Write-Host '      c) 若本机装有 DSH，可直接复制其内置 electron：' -ForegroundColor Yellow
  Write-Host '         Copy-Item "$env:USERPROFILE\.dsh\electron\*" "' + $winDir + '" -Recurse'
}

Write-Host ''
Write-Host '=== 安装完成 ===' -ForegroundColor Green
Write-Host "悬浮窗目录：$winDir"
Write-Host '启动方式：双击 code-tutor\启动悬浮窗.cmd（或 dsh 界面左下角 CT 按钮）'
if (Test-Path $cli) { Write-Host '⚠️ 记得重启 DSH 桌面端让桥接插件生效' -ForegroundColor Yellow }

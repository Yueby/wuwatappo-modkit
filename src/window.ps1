# The window that opens when the exe is double-clicked: what is in place, and two buttons.
#
# It does nothing itself. Every button runs this same exe with a command (setup, uninstall, setup
# status, update) and shows what it printed, so the window and the command line can never disagree.
# Started by src/commands/window.js, which writes this file out of the exe as UTF-8 with a BOM
# (Windows PowerShell reads a file without one as ANSI, and the Chinese below would be garbage).
#
# Opening it also asks GitHub whether there is a newer version (`update --check`), and if there is,
# takes it (`update --reopen`): the exe downloads it, checks it, replaces itself and runs the new
# one's setup, which opens a new window; exit code 10 says so, and this one closes.

# $Script: when the program is node and a script (from the repository), the script it is run with.
# $ModsDir: the mods folder, as the program itself says it is (never worked out from $Exe: from the
# repository that is node.exe, and its folder is not the app's).
param(
  [Parameter(Mandatory)][string]$Exe,
  [Parameter(Mandatory)][string]$ModsDir,
  [string]$Version = '?',
  [string]$Script = ''
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$UpdatedAndReopened = 10     # what `update --reopen` exits with (src/commands/update.js)

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Wuwa Tappo Mod'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

$versionLabel = New-Object System.Windows.Forms.Label
$versionLabel.Text = "启动器 v$Version"
$versionLabel.Location = New-Object System.Drawing.Point(14, 12)
$versionLabel.AutoSize = $true
$form.Controls.Add($versionLabel)

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.ReadOnly = $true
$box.ScrollBars = 'Vertical'
$box.BackColor = [System.Drawing.Color]::White
$box.Font = New-Object System.Drawing.Font('Consolas', 9)
$box.Location = New-Object System.Drawing.Point(12, 38)
$box.Size = New-Object System.Drawing.Size(556, 264)
$form.Controls.Add($box)

function New-Button([string]$Text, [int]$X, [int]$Width) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Location = New-Object System.Drawing.Point($X, 314)
  $button.Size = New-Object System.Drawing.Size($Width, 32)
  $form.Controls.Add($button)
  return $button
}

$install = New-Button '安装' 12 100
$uninstall = New-Button '卸载' 122 100
$folder = New-Button '打开 mods 文件夹' 232 140
$refresh = New-Button '刷新' 382 70

$restore = New-Object System.Windows.Forms.CheckBox
$restore.Text = '卸载时把软件的 exe 也还原成原版'
$restore.Location = New-Object System.Drawing.Point(14, 356)
$restore.AutoSize = $true
$form.Controls.Add($restore)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = '安装一次就够了：以后直接运行 WuwaTappo.exe，mod 会跟着启动。软件更新后再点一次“安装”。'
$hint.Location = New-Object System.Drawing.Point(14, 380)
$hint.AutoSize = $true
$hint.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($hint)
$form.ClientSize = New-Object System.Drawing.Size(580, 408)

$buttons = @($install, $uninstall, $refresh)
$script:process = $null
$script:output = $null
$script:errors = $null
$script:then = $null
$script:after = $null
$script:quiet = $false
$script:resultText = ''
$script:resultCode = 0

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150

# Run the exe with these arguments, one at a time (the buttons are off meanwhile).
#   Normally: show $Title, and when it is done show what it printed; $Then, if there is one, runs
#             instead of showing it (what was printed is kept to go above what $Then shows), and
#             $After runs once something has been shown.
#   -Quiet:   show nothing; $Then runs with the result in $script:resultText / $script:resultCode.
function Start-Command([string]$Arguments, [string]$Title, $Then = $null, $After = $null, [switch]$Quiet) {
  foreach ($button in $buttons) { $button.Enabled = $false }
  if (-not $Quiet) { $box.Text = $Title }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Exe
  $info.Arguments = $Arguments
  if ($Script) { $info.Arguments = '"' + $Script + '" ' + $Arguments }
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $info.StandardErrorEncoding = [System.Text.Encoding]::UTF8
  try {
    $script:process = [System.Diagnostics.Process]::Start($info)
  } catch {
    $box.Text = "无法运行 $Exe`r`n$($_.Exception.Message)"
    foreach ($button in $buttons) { $button.Enabled = $true }
    return
  }
  $script:output = $script:process.StandardOutput.ReadToEndAsync()
  $script:errors = $script:process.StandardError.ReadToEndAsync()
  $script:then = $Then
  $script:after = $After
  $script:quiet = [bool]$Quiet
  $timer.Start()
}

$timer.Add_Tick({
  if (-not $script:process.HasExited -or -not $script:output.IsCompleted -or -not $script:errors.IsCompleted) { return }
  $timer.Stop()
  $text = ($script:output.Result + $script:errors.Result).Trim() -replace "`r?`n", "`r`n"
  $script:resultText = $text
  $script:resultCode = $script:process.ExitCode
  $script:process = $null
  foreach ($button in $buttons) { $button.Enabled = $true }
  $then = $script:then
  $after = $script:after
  $script:then = $null
  $script:after = $null
  if ($script:quiet) {
    if ($then) { & $then }
  } elseif ($then) {
    # What it said is kept above the fresh status, so a failure is not wiped by the refresh.
    $script:said = $text
    & $then
  } else {
    if ($script:said) { $text = $script:said + "`r`n`r`n---`r`n" + $text; $script:said = $null }
    $box.Text = $text
    $box.SelectionStart = 0
    if ($after) { & $after }
  }
})

function Show-Status($After = $null) {
  Start-Command 'setup status' '正在读取…' $null $After
}

# --- updating -------------------------------------------------------------------------

function Show-Version([string]$Note) {
  $versionLabel.Text = "启动器 v$Version  $Note".TrimEnd()
}

# Takes the new version when there is one: downloaded, checked, put in place, set up, window reopened.
function Update-Program($Latest) {
  $script:updatingTo = $Latest      # the block below runs after this function has returned
  Show-Version "（发现新版本 v$Latest，正在更新…）"
  Start-Command 'update --reopen' "正在下载新版本 v$Latest（约 90 MB），之后会重新打补丁，可能弹出一次管理员确认…" {
    if ($script:resultCode -eq $UpdatedAndReopened) { $form.Close(); return }
    Show-Version "（更新到 v$($script:updatingTo) 没有完成）"
    Show-Status
  }
}

# `update --check --json` printed one line of JSON: what is running, and what is the latest.
function Read-Check {
  $line = ($script:resultText -split "`r?`n" | Where-Object { $_ -like '{*' } | Select-Object -Last 1)
  try { $answer = $line | ConvertFrom-Json } catch { Show-Version '（检查更新失败）'; return }
  if ($answer.error) { Show-Version "（检查更新失败：$($answer.error)）"; return }
  if (-not $answer.latest) { Show-Version '（还没有发布过新版本）'; return }
  if (-not $answer.newer) { Show-Version '（已是最新）'; return }
  Update-Program $answer.latest
}

function Check-Update {
  Show-Version '（正在检查更新…）'
  Start-Command 'update --check --json' '' { Read-Check } $null -Quiet
}

# What happens when the window opens, and on 刷新: the status, then the check.
function Start-Up {
  Show-Status { Check-Update }
}

$install.Add_Click({ Start-Command 'setup' '正在安装…（会弹出一次管理员确认）' { Show-Status } })
$uninstall.Add_Click({
  $arguments = 'uninstall'
  if ($restore.Checked) { $arguments = 'uninstall --restore-exe' }
  Start-Command $arguments '正在卸载…' { Show-Status }
})
$refresh.Add_Click({ $script:said = $null; Start-Up })
$folder.Add_Click({
  New-Item -ItemType Directory -Force -Path $ModsDir | Out-Null
  Start-Process explorer.exe -ArgumentList "`"$ModsDir`""
})

$form.Add_Shown({ Start-Up })
[void]$form.ShowDialog()

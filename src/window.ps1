# The window that opens when the exe is double-clicked: what is in place, and two buttons.
#
# It does nothing itself. Every button runs this same exe with a command (setup, uninstall, setup
# status) and shows what it printed, so the window and the command line can never disagree.
# Started by src/commands/window.js, which writes this file out of the exe as UTF-8 with a BOM
# (Windows PowerShell reads a file without one as ANSI, and the Chinese below would be garbage).

# $Script: when the program is node and a script (from the repository), the script it is run with.
param([Parameter(Mandatory)][string]$Exe, [string]$Script = '')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Wuwa Tappo Mod'
$form.ClientSize = New-Object System.Drawing.Size(580, 400)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.ReadOnly = $true
$box.ScrollBars = 'Vertical'
$box.BackColor = [System.Drawing.Color]::White
$box.Font = New-Object System.Drawing.Font('Consolas', 9)
$box.Location = New-Object System.Drawing.Point(12, 12)
$box.Size = New-Object System.Drawing.Size(556, 290)
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

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150

# Run the exe with these arguments, show what it prints when it is done, then call $Then.
function Start-Command([string]$Arguments, [string]$Title, $Then) {
  foreach ($button in $buttons) { $button.Enabled = $false }
  $box.Text = $Title
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
  $timer.Start()
}

$timer.Add_Tick({
  if (-not $script:process.HasExited -or -not $script:output.IsCompleted -or -not $script:errors.IsCompleted) { return }
  $timer.Stop()
  $text = ($script:output.Result + $script:errors.Result).Trim() -replace "`r?`n", "`r`n"
  $code = $script:process.ExitCode
  $script:process = $null
  foreach ($button in $buttons) { $button.Enabled = $true }
  if ($script:then) {
    $next = $script:then
    $script:then = $null
    # What it said is kept above the fresh status, so a failure is not wiped by the refresh.
    $script:said = $text
    $script:saidCode = $code
    & $next
  } else {
    if ($script:said) { $text = $script:said + "`r`n`r`n---`r`n" + $text; $script:said = $null }
    $box.Text = $text
    $box.SelectionStart = 0
  }
})

function Show-Status {
  Start-Command 'setup status' '正在读取…' $null
}

$install.Add_Click({ Start-Command 'setup' '正在安装…（会弹出一次管理员确认）' { Show-Status } })
$uninstall.Add_Click({
  $arguments = 'uninstall'
  if ($restore.Checked) { $arguments = 'uninstall --restore-exe' }
  Start-Command $arguments '正在卸载…' { Show-Status }
})
$refresh.Add_Click({ $script:said = $null; Show-Status })
$folder.Add_Click({
  $mods = Join-Path (Split-Path -Parent $Exe) 'mods'
  New-Item -ItemType Directory -Force -Path $mods | Out-Null
  Start-Process explorer.exe -ArgumentList "`"$mods`""
})

$form.Add_Shown({ Show-Status })
[void]$form.ShowDialog()

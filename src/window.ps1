# The window that opens when the exe is double-clicked: what is in place, and two buttons (install, uninstall).
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

# Shown while something is being downloaded, to the right of the version (the label stays short then).
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(400, 14)
$bar.Size = New-Object System.Drawing.Size(168, 14)
$bar.Minimum = 0
$bar.Maximum = 100
$bar.Visible = $false
$form.Controls.Add($bar)

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.ReadOnly = $true
$box.ScrollBars = 'Vertical'
$box.BackColor = [System.Drawing.Color]::White
$box.Font = New-Object System.Drawing.Font('Consolas', 9)
$box.Location = New-Object System.Drawing.Point(12, 38)
$box.Size = New-Object System.Drawing.Size(556, 264)
$form.Controls.Add($box)

function New-Button([string]$Text, [int]$X, [int]$Width, [int]$Y = 314) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Location = New-Object System.Drawing.Point($X, $Y)
  $button.Size = New-Object System.Drawing.Size($Width, 32)
  $form.Controls.Add($button)
  return $button
}

$install = New-Button '安装' 12 100
$uninstall = New-Button '卸载' 122 100
$folder = New-Button '打开插件文件夹' 232 140
$refresh = New-Button '刷新' 382 70
$pluginsButton = New-Button '插件…' 462 100

# Developing a plugin: the program uses the folder it is written in, as it is, and loads every edit.
$devBox = New-Object System.Windows.Forms.CheckBox
$devBox.Text = '开发模式：直接用本地的插件文件夹，改了就生效'
$devBox.Location = New-Object System.Drawing.Point(14, 360)
$devBox.AutoSize = $true
$form.Controls.Add($devBox)
$devFolder = New-Button '选择文件夹…' 452 110 356

$hint = New-Object System.Windows.Forms.Label
$hint.Text = '装一次就行，以后直接打开 WuwaTappo，插件会跟着启动。软件更新后，再点一次“安装”。' + "`n" +
  '安装和卸载时，如果软件正在运行，会先关闭它，做完再自动打开。卸载会把软件还原成原版。'
$hint.Location = New-Object System.Drawing.Point(14, 400)
$hint.AutoSize = $true
$hint.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($hint)
$form.ClientSize = New-Object System.Drawing.Size(580, 440)

# Everything that starts a command is off while one runs (the box too: a second command would take the first one's place).
$buttons = @($install, $uninstall, $refresh, $pluginsButton, $devFolder, $devBox)
$script:dev = $null          # what `dev status --json` said: { enabled, dirs }
$script:process = $null
$script:lines = $null        # what the program has said so far, but for progress
$script:lineTask = $null     # the line being waited for; $null once there are no more
$script:title = ''
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
    $box.Text = "运行不了 $Exe`r`n$($_.Exception.Message)"
    foreach ($button in $buttons) { $button.Enabled = $true }
    return
  }
  $script:lines = New-Object System.Collections.ArrayList
  $script:lineTask = $script:process.StandardOutput.ReadLineAsync()
  $script:errors = $script:process.StandardError.ReadToEndAsync()
  $script:title = $Title
  $script:then = $Then
  $script:after = $After
  $script:quiet = [bool]$Quiet
  $timer.Start()
}

# A line that says how far a download is moves the bar; the others are kept for when it is done.
function Show-Progress([double]$Received, [double]$Total) {
  $done = '{0:N1}' -f ($Received / 1MB)
  if ($Total -gt 0) {
    $percent = [int][Math]::Min(100, [Math]::Floor($Received * 100 / $Total))
    $bar.Style = 'Continuous'
    $bar.Value = $percent
    $line = "$done / $('{0:N1}' -f ($Total / 1MB)) MB（$percent%）"
    $note = "（正在下载 v$($script:updatingTo)，$percent%）"
  } else {
    $bar.Style = 'Marquee'
    $line = "$done MB"
    $note = "（正在下载 v$($script:updatingTo)）"
  }
  $bar.Visible = $true
  $box.Text = $script:title + "`r`n`r`n" + $line
  if ($script:updatingTo) { Show-Version $note }
}

$timer.Add_Tick({
  while ($script:lineTask -and $script:lineTask.IsCompleted) {
    $line = $script:lineTask.Result
    if ($null -eq $line) { $script:lineTask = $null; break }
    if ($line -match '^progress (\d+) (\d+)\s*$') { Show-Progress ([double]$Matches[1]) ([double]$Matches[2]) }
    else { [void]$script:lines.Add($line) }
    $script:lineTask = $script:process.StandardOutput.ReadLineAsync()
  }
  if (-not $script:process.HasExited -or $script:lineTask -or -not $script:errors.IsCompleted) { return }
  $timer.Stop()
  $bar.Visible = $false
  $text = ((($script:lines -join "`n") + "`n" + $script:errors.Result).Trim()) -replace "`r?`n", "`r`n"
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
  Show-Version "（发现新版本 v$Latest，正在更新）"
  Start-Command 'update --reopen --progress' "正在下载新版本 v$Latest`r`n下载完成后会重新打补丁，可能弹出一次管理员确认。" {
    if ($script:resultCode -eq $UpdatedAndReopened) { $form.Close(); return }
    Show-Version "（更新到 v$($script:updatingTo) 没有成功）"
    Show-Status
  }
}

# `update --check --json` printed one line of JSON: what is running, and what is the latest.
function Read-Check {
  $line = ($script:resultText -split "`r?`n" | Where-Object { $_ -like '{*' } | Select-Object -Last 1)
  try { $answer = $line | ConvertFrom-Json } catch { Show-Version '（检查更新失败）'; return }
  if ($answer.error) { Show-Version "（检查更新失败：$($answer.error)）"; return }
  if (-not $answer.latest) { Show-Version '（还没有新版本）'; return }
  if (-not $answer.newer) { Show-Version '（已是最新）'; return }
  Update-Program $answer.latest
}

function Check-Update {
  Show-Version '（正在检查更新…）'
  Start-Command 'update --check --json' '' { Read-Check } $null -Quiet
}

# --- dev mode ---------------------------------------------------------------------------------------------

# A path as one command line argument. In quotes, a backslash before the closing quote would swallow it
# ("D:\work\" is not a path in quotes), so a trailing one is doubled: that is how Windows reads it back as one.
# (Taking it off instead turns the root of a drive, E:\, into E:, which is a different place.)
function ConvertTo-Argument([string]$Path) {
  if ($Path.EndsWith('\')) { $Path = $Path + '\' }
  return '"' + $Path + '"'
}

# Asks the person for the folder a plugin is written in. A function of its own so that a test can answer.
function Select-DevFolder {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = '选择写插件的文件夹：可以是一个插件的文件夹，也可以是放着很多插件的文件夹'
  if ($dialog.ShowDialog($form) -eq 'OK') { return $dialog.SelectedPath }
  return $null
}

# `dev status --json` printed one line: show it in the box.
function Apply-Dev {
  $line = ($script:resultText -split "`r?`n" | Where-Object { $_ -like '{*' } | Select-Object -Last 1)
  try { $script:dev = $line | ConvertFrom-Json } catch { return }
  $devBox.Checked = [bool]$script:dev.enabled
  $count = @($script:dev.mods).Count
  if ($script:dev.enabled) { $devBox.Text = "开发模式：直接用本地的插件文件夹，改了就生效（现在用着 $count 个）" }
  else { $devBox.Text = '开发模式：直接用本地的插件文件夹，改了就生效' }
}

function Read-Dev($Then) {
  Start-Command 'dev status --json' '' $Then $null -Quiet
}

# Switch it, then show where things stand.
function Set-Dev([string]$Arguments, [string]$Title) {
  Start-Command $Arguments $Title { Read-Dev { Apply-Dev; Show-Status } }
}

$devBox.Add_Click({
  if (-not $devBox.Checked) { Set-Dev 'dev off' "正在关闭开发模式…`r`n回到用仓库里装的插件。"; return }
  $dir = $null
  if (-not (@($script:dev.dirs).Count)) {
    $dir = Select-DevFolder
    if (-not $dir) { $devBox.Checked = $false; return }
  }
  if ($dir) { Set-Dev ('dev on ' + (ConvertTo-Argument $dir)) "正在打开开发模式…" } else { Set-Dev 'dev on' "正在打开开发模式…" }
})

$devFolder.Add_Click({
  $dir = Select-DevFolder
  if ($dir) { Set-Dev ('dev on ' + (ConvertTo-Argument $dir)) "正在打开开发模式…" }
})

# What happens when the window opens, and on 刷新: where dev mode stands, the status, then the check.
function Start-Up {
  Read-Dev { Apply-Dev; Show-Status { Check-Update } }
}

$install.Add_Click({ Start-Command 'setup' "正在安装…`r`n过程中会弹出一次管理员确认。软件正在运行的话，会先关闭，装好后自动重新打开。" { Show-Status } })
$uninstall.Add_Click({ Start-Command 'uninstall' "正在卸载…`r`n软件正在运行的话，会先关闭，还原后自动重新打开。" { Show-Status } })
$refresh.Add_Click({ $script:said = $null; Start-Up })
$folder.Add_Click({
  New-Item -ItemType Directory -Force -Path $ModsDir | Out-Null
  Start-Process explorer.exe -ArgumentList "`"$ModsDir`""
})

# --- plugins -----------------------------------------------------------------------------------

# Asks the person. A function of its own so that a test can answer for them.
function Confirm-Action([string]$Text) {
  return ([System.Windows.Forms.MessageBox]::Show($Text, 'Wuwa Tappo Mod', 'YesNo', 'Question') -eq 'Yes')
}

# Run the program and wait for it, keeping the window alive meanwhile. Returns @{ Text; Code }.
function Invoke-Modkit([string]$Arguments) {
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
  try { $process = [System.Diagnostics.Process]::Start($info) } catch { return @{ Text = "运行不了 $Exe $($_.Exception.Message)"; Code = -1 } }
  $out = $process.StandardOutput.ReadToEndAsync()
  $err = $process.StandardError.ReadToEndAsync()
  while (-not ($process.HasExited -and $out.IsCompleted -and $err.IsCompleted)) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 40
  }
  return @{ Text = (($out.Result + $err.Result).Trim() -replace "`r?`n", "`r`n"); Code = $process.ExitCode }
}

# What the person is asked before something is installed: what the plugin declares, from the registry's list.
# (The program checks that the package says the same before it puts anything in place.)
function Get-PluginFacts($Plugin) {
  $labels = @{ files = '读写文件'; network = '联网'; clipboard = '读写剪贴板'; run = '运行其他程序' }
  $lines = @()
  $permissions = @($Plugin.permissions | ForEach-Object { if ($labels.ContainsKey($_)) { $labels[$_] } else { $_ } })
  if ($permissions.Count) { $lines += ('作者声明的权限：' + ($permissions -join '、')) } else { $lines += '作者没有声明需要特别的权限' }
  if ($Plugin.nodePart) { $lines += '后台程序：有。它会作为独立程序在电脑上运行，权限和您的账号一样，不受限制。' }
  else { $lines += '后台程序：无' }
  $needs = @($Plugin.requires.PSObject.Properties | ForEach-Object { "$($_.Name) $($_.Value)" })
  if ($needs.Count) { $lines += ('需要先装好：' + ($needs -join '、')) }
  $dependencies = @($Plugin.dependencies)
  if ($dependencies.Count) { $lines += ("会一并下载 $($dependencies.Count) 个组件：" + ($dependencies -join '、')) }
  return $lines
}

function Get-PluginQuestion($Plugin, [string]$Verb) {
  $lines = @("$Verb「$($Plugin.name)」$($Plugin.version)？", '')
  if ($Plugin.description) { $lines += $Plugin.description; $lines += '' }
  $lines += Get-PluginFacts $Plugin
  $lines += ''
  $lines += '插件的脚本会在软件窗口里运行，软件能做的它都能做。请只安装信得过的插件。'
  return ($lines -join "`r`n")
}

function Get-PluginStatus($Plugin) {
  if (-not $Plugin.installed) { return '未安装' }
  if ($Plugin.update) { return "有新版本（已装 $($Plugin.installedVersion)）" }
  if ($Plugin.fromRegistry) { return "已安装 $($Plugin.installedVersion)" }
  return '已有同名插件（不是从这里安装的）'
}

# The plugins window. Returns the form and the controls a test needs to reach.
function New-PluginsWindow {
  $dialog = New-Object System.Windows.Forms.Form
  $dialog.Text = '插件'
  $dialog.ClientSize = New-Object System.Drawing.Size(640, 440)
  $dialog.StartPosition = 'CenterParent'
  $dialog.FormBorderStyle = 'FixedDialog'
  $dialog.MaximizeBox = $false
  $dialog.MinimizeBox = $false
  $dialog.Font = $form.Font

  $list = New-Object System.Windows.Forms.ListView
  $list.View = 'Details'
  $list.FullRowSelect = $true
  $list.MultiSelect = $false
  $list.HideSelection = $false
  $list.Location = New-Object System.Drawing.Point(12, 12)
  $list.Size = New-Object System.Drawing.Size(616, 220)
  foreach ($column in @(@('名称', 150), @('版本', 70), @('状态', 130), @('说明', 240))) {
    [void]$list.Columns.Add($column[0], $column[1])
  }
  $dialog.Controls.Add($list)

  $details = New-Object System.Windows.Forms.TextBox
  $details.Multiline = $true
  $details.ReadOnly = $true
  $details.ScrollBars = 'Vertical'
  $details.BackColor = [System.Drawing.Color]::White
  $details.Location = New-Object System.Drawing.Point(12, 242)
  $details.Size = New-Object System.Drawing.Size(616, 140)
  $dialog.Controls.Add($details)

  $make = {
    param([string]$Text, [int]$X, [int]$Width)
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.Location = New-Object System.Drawing.Point($X, 394)
    $button.Size = New-Object System.Drawing.Size($Width, 32)
    $dialog.Controls.Add($button)
    return $button
  }
  $act = & $make '安装' 12 100
  $remove = & $make '卸载' 122 100
  $reload = & $make '刷新' 232 80
  $close = & $make '关闭' 528 100
  $act.Enabled = $false
  $remove.Enabled = $false

  return @{ Form = $dialog; List = $list; Details = $details; Act = $act; Remove = $remove; Reload = $reload; Close = $close; Plugins = @() }
}

# What is selected, as the plugin object, or $null.
function Get-SelectedPlugin($Window) {
  if ($Window.List.SelectedItems.Count -eq 0) { return $null }
  return $Window.List.SelectedItems[0].Tag
}

function Update-PluginButtons($Window) {
  $plugin = Get-SelectedPlugin $Window
  $Window.Act.Enabled = $false
  $Window.Remove.Enabled = $false
  if (-not $plugin) { $Window.Act.Text = '安装'; return }
  $Window.Remove.Enabled = [bool]$plugin.installed
  if (-not $plugin.installed) { $Window.Act.Text = '安装'; $Window.Act.Enabled = $true }
  elseif ($plugin.update) { $Window.Act.Text = '更新'; $Window.Act.Enabled = $true }
  else { $Window.Act.Text = '已是最新' }
  $author = ''
  if ($plugin.author) { $author = "作者：$($plugin.author)`r`n" }
  $Window.Details.Text = "$($plugin.name)  $($plugin.version)`r`n$author$($plugin.description)`r`n`r`n" + ((Get-PluginFacts $plugin) -join "`r`n")
}

# Ask the program for the registry's list and show it.
function Update-PluginList($Window) {
  $Window.Act.Enabled = $false
  $Window.Remove.Enabled = $false
  $Window.Details.Text = '正在读取插件列表…'
  $result = Invoke-Modkit 'mods browse --json'
  $line = ($result.Text -split "`r?`n" | Where-Object { $_ -like '{*' } | Select-Object -Last 1)
  try { $answer = $line | ConvertFrom-Json } catch { $answer = $null }
  $Window.List.Items.Clear()
  if (-not $answer) { $Window.Details.Text = "没能读取插件列表：$($result.Text)"; return }
  $Window.Plugins = @($answer.mods)
  foreach ($plugin in $Window.Plugins) {
    $item = New-Object System.Windows.Forms.ListViewItem($plugin.name)
    [void]$item.SubItems.Add([string]$plugin.version)
    [void]$item.SubItems.Add((Get-PluginStatus $plugin))
    [void]$item.SubItems.Add([string]$plugin.description)
    $item.Tag = $plugin
    [void]$Window.List.Items.Add($item)
  }
  if (-not $Window.Plugins.Count) { $Window.Details.Text = '仓库里还没有插件。' }
  else { $Window.Details.Text = "共 $($Window.Plugins.Count) 个插件。选一个看详情。" }
  if (@($answer.problems).Count) { $Window.Details.Text += "`r`n（有 $(@($answer.problems).Count) 个条目格式不对，已跳过）" }
}

# Install or update the selected one, after the person has read what it declares and said yes.
function Invoke-PluginAct($Window) {
  $plugin = Get-SelectedPlugin $Window
  if (-not $plugin -or -not $Window.Act.Enabled) { return }
  $update = [bool]$plugin.installed
  $verb = '安装'
  if ($update) { $verb = '更新' }
  if (-not (Confirm-Action (Get-PluginQuestion $plugin $verb))) { return }
  # --expect: the version the person was just asked about. --yes says the question has been asked, and
  # without it the registry could have moved on to another version by the time this runs.
  $command = "mods get $($plugin.id) --expect $($plugin.version) --yes"
  if ($update) { $command = "mods update $($plugin.id) --expect $($plugin.version) --yes" }
  $Window.Form.Enabled = $false
  $Window.Details.Text = "正在$verb「$($plugin.name)」…"
  $result = Invoke-Modkit $command
  $Window.Form.Enabled = $true
  Update-PluginList $Window
  $Window.Details.Text = (Get-ActionSummary $result "$verb「$($plugin.name)」") + "`r`n`r`n" + $Window.Details.Text
}

# "已安装「x」" when it worked; when it did not, that, and what the program said.
function Get-ActionSummary($Result, [string]$What) {
  if ($Result.Code -eq 0) { return "已完成：$What" }
  return "$What 没有成功。`r`n`r`n详细信息：`r`n$($Result.Text)"
}

function Invoke-PluginRemove($Window) {
  $plugin = Get-SelectedPlugin $Window
  if (-not $plugin -or -not $plugin.installed) { return }
  if (-not (Confirm-Action "卸载「$($plugin.name)」？`r`n`r`n会删除它的文件夹。它在软件里保存的设置会保留，以后再装回来还能用。")) { return }
  $Window.Form.Enabled = $false
  $result = Invoke-Modkit "mods remove $($plugin.id)"
  $Window.Form.Enabled = $true
  Update-PluginList $Window
  $Window.Details.Text = (Get-ActionSummary $result "卸载「$($plugin.name)」") + "`r`n`r`n" + $Window.Details.Text
}

# Wire a plugins window up. The handlers reach it through $script:plugins: a scriptblock made with
# GetNewClosure cannot see this script's functions, and there is one plugins window at a time anyway.
function Connect-PluginsWindow($Window) {
  $script:plugins = $Window
  $Window.List.Add_SelectedIndexChanged({ Update-PluginButtons $script:plugins })
  $Window.Act.Add_Click({ Invoke-PluginAct $script:plugins })
  $Window.Remove.Add_Click({ Invoke-PluginRemove $script:plugins })
  $Window.Reload.Add_Click({ Update-PluginList $script:plugins })
  $Window.Close.Add_Click({ $script:plugins.Form.Close() })
}

function Show-Plugins {
  $window = New-PluginsWindow
  Connect-PluginsWindow $window
  $window.Form.Add_Shown({ Update-PluginList $script:plugins })
  [void]$window.Form.ShowDialog($form)
}

$pluginsButton.Add_Click({ Show-Plugins })

$form.Add_Shown({ Start-Up })
[void]$form.ShowDialog()

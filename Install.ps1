# Makes this PC run Shubham Agentic from this build folder (F-020). No admin needed.
#   Install.cmd                 install, and start it now
#   Install.cmd -Role hub       the first time on the hub (the role is remembered after that)
#   Install.cmd -Remove         stop it and take it out of the logon programs
#   Install.cmd -NoWhisper      all of it but step 5 (the old way: Whisper by hand, or never)
# What it does:
#   1. installs the build's packages (npm ci), when they aren't there yet;
#   2. stops Shubham Agentic Dev if it is running on this PC (its agent, the loop that restarts
#      it, and its dev server), since they hold the same ports; Dev's own files are not touched;
#   3. starts this build at logon instead of Dev: a launcher in the Startup folder runs
#      "Start hidden.vbs" here, and Dev's launcher (shubham-agentic-hub.vbs) comes out. To go
#      back to Dev: run Dev's agent\scripts\install-hub-startup.ps1, and Install.cmd -Remove here;
#   4. starts it, and opens http://localhost:5173 when it answers;
#   5. F-251: fetches Whisper (speech to text) when this PC doesn't have it yet: the official whisper.cpp
#      program and its small model, about 497 MB, each checked against its pinned SHA-256, into
#      %LOCALAPPDATA%\shubham-agentic (agent\scripts\fetch-whisper.ts). What is there already is kept as it
#      is. The app is up by then and finds it by itself; a failure doesn't fail the install (the mic then
#      uses the phone's recogniser, and PC control > Dependencies has the command to try again).
param([string]$Role = '', [switch]$Remove, [switch]$NoWhisper)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startup 'shubham-agentic.vbs'
$devLauncher = Join-Path $startup 'shubham-agentic-hub.vbs'

function Stop-Matching([string]$what, [scriptblock]$match) {
  $procs = Get-CimInstance Win32_Process | Where-Object $match
  foreach ($p in $procs) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; "  stopped $what (pid $($p.ProcessId))" } catch {}
  }
}

if ($Remove) {
  if (Test-Path $launcher) { Remove-Item $launcher; "Removed $launcher" }
  $folder = [regex]::Escape($here)
  Stop-Matching 'its restart loop' { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match $folder -and $_.CommandLine -match 'Start\.cmd' }
  Stop-Matching 'the app' { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'agent/main\.ts' -and $_.CommandLine -match '--app' }
  "Shubham Agentic (this build) is stopped and won't start at logon."
  return
}

foreach ($tool in 'node', 'git', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool isn't installed (or not on PATH). Install it, then run this again." }
}

Set-Location $here
if (-not (Test-Path (Join-Path $here 'node_modules'))) {
  '1. Installing its packages (npm ci)...'
  & npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed: see above.' }
} else { '1. Its packages are installed.' }

'2. Stopping Shubham Agentic Dev, if it runs here...'
# The loop first, or it starts Dev's agent again 5 s after it stops. Then whatever holds the
# app's two ports (the agent's API, 21221, and the page, 5173), so test agents on other
# ports are left alone.
Stop-Matching "Dev's restart loop" { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'shubham-agentic-dev' -and $_.CommandLine -match 'start-hub\.cmd' }
foreach ($port in 21221, 5173) {
  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($id in $owners) {
    Stop-Matching "what held port $port" { $_.ProcessId -eq $id -and $_.Name -eq 'node.exe' -and $_.CommandLine -notmatch '--app' }
  }
}
# And this build's own, when Install runs again.
$folder = [regex]::Escape($here)
Stop-Matching 'the previous run of this build' { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match $folder -and $_.CommandLine -match 'Start\.cmd' }
Stop-Matching 'the previous run of this build' { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'agent/main\.ts' -and $_.CommandLine -match '--app' }
# The Agents section's chats of the agent just stopped, left running on their own by a hard
# stop: their claude has the app's tools file (agentic\mcp.json). Each picks its conversation
# back up when opened again.
Stop-Matching 'an agent chat left running' { $_.Name -eq 'claude.exe' -and $_.CommandLine -match 'shubham-agentic\\agent\\agentic\\mcp\.json' }
Start-Sleep -Seconds 2

'3. Starting it at logon...'
if (Test-Path $devLauncher) { Remove-Item $devLauncher; "  removed Dev's launcher $devLauncher" }
$target = (Join-Path $here 'Start hidden.vbs').Replace('"', '""')
Set-Content -Path $launcher -Encoding ASCII -Value @(
  "' Starts Shubham Agentic (the build) at logon. Made by Install.ps1 in the build folder.",
  "CreateObject(""WScript.Shell"").Run ""wscript.exe """"$target"""""", 0, False"
)
"  $launcher -> $here"

'4. Starting it now...'
# Through WMI, so it belongs to no window or session this ran from and keeps going when they close.
$vbs = Join-Path $here 'Start hidden.vbs'
$line = "wscript.exe `"$vbs`"" + $(if ($Role) { " --role $Role" } else { '' })
$null = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line; CurrentDirectory = $here }
$up = $false
for ($i = 0; $i -lt 60 -and -not $up; $i++) {
  Start-Sleep -Seconds 1
  try { $null = Invoke-WebRequest -Uri 'http://localhost:5173/' -UseBasicParsing -TimeoutSec 2; $up = $true } catch {}
}
if ($up) {
  '  It answers at http://localhost:5173'
  Start-Process 'http://localhost:5173'
} else {
  "  It hasn't answered yet: see $env:LOCALAPPDATA\shubham-agentic\agent-console.log"
}

'5. Whisper (speech to text), if this PC does not have it yet...'
if ($NoWhisper) {
  '  Skipped (-NoWhisper). PC control > Dependencies has the command for it.'
} else {
  # Never fatal: its result is read from $LASTEXITCODE, and what it says on its error stream is only shown.
  $ErrorActionPreference = 'Continue'
  & node (Join-Path $here 'agent\scripts\fetch-whisper.ts') --part all
  if ($LASTEXITCODE -ne 0) { "  Whisper isn't installed (see above). The app works without it; PC control > Dependencies has the command to try again." }
}

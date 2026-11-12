# Installs dist/davinci-*-win-x64-setup.exe silently with the web server, checks what it set up, uninstalls it and
# checks that nothing is left. For CI (Windows runners run elevated); on your own computer it really installs.
#   pwsh installer/windows/test-installer.ps1
$ErrorActionPreference = 'Stop'
$port = 8795
$setup = Get-ChildItem dist/davinci-*-win-x64-setup.exe | Select-Object -First 1
$dir = Join-Path $env:LOCALAPPDATA 'Programs\DaVinci'
$exe = Join-Path $dir 'DaVinci.exe'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$failed = 0
function Check($name, $ok, $detail = '') {
  if ($ok) { Write-Host "PASS $name $detail" } else { Write-Host "FAIL $name $detail"; $script:failed++ }
}
function Page() {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$port/").Content } catch { $null }
}
function Rule() { Get-NetFirewallRule -DisplayName 'DaVinci web server' -ErrorAction SilentlyContinue }

Write-Host "Installing $($setup.Name) /S /WEBSERVER /PORT=$port"
Start-Process -Wait -FilePath $setup.FullName -ArgumentList '/S', '/WEBSERVER', "/PORT=$port"
Check 'installed' (Test-Path $exe) $exe
$run = (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).'DaVinci web server'
Check 'starts at sign-in (Run key)' ($run -like "*DaVinci.exe`" --serve --host 0.0.0.0 --port $port") $run
$rule = Rule
Check 'firewall rule' ($null -ne $rule -and $rule.Enabled -eq 'True' -and $rule.Direction -eq 'Inbound' -and $rule.Action -eq 'Allow') "$($rule.Profile)"
if ($rule) {
  Check 'firewall: private networks only' ("$($rule.Profile)" -eq 'Private') "$($rule.Profile)"
  Check 'firewall: this port, TCP' ((($rule | Get-NetFirewallPortFilter).LocalPort -eq "$port") -and (($rule | Get-NetFirewallPortFilter).Protocol -eq 'TCP'))
  Check 'firewall: DaVinci.exe only' (($rule | Get-NetFirewallApplicationFilter).Program -eq $exe) ($rule | Get-NetFirewallApplicationFilter).Program
}
Check '.davinci file type' ((Get-ItemProperty 'HKCU:\Software\Classes\.davinci' -ErrorAction SilentlyContinue).'(default)' -eq 'DaVinci project')

$page = $null
for ($i = 0; $i -lt 40 -and -not $page; $i++) { Start-Sleep 1; $page = Page }
if (-not $page) {
  # the installer starts the server through Explorer, which a CI session may not have: start it as sign-in would
  Write-Host 'Not started by the installer here; starting it from the Run key'
  Start-Process -FilePath $exe -ArgumentList '--serve', '--host', '0.0.0.0', '--port', "$port"
  for ($i = 0; $i -lt 40 -and -not $page; $i++) { Start-Sleep 1; $page = Page }
}
Check 'web server answers' ($page -match '<title>DaVinci</title>')
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4Address.IPAddress | Select-Object -First 1
if ($ip) {
  $lan = try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://${ip}:$port/").Content } catch { $null }
  Check "answers on the network address $ip" ($lan -match '<title>DaVinci</title>')
}
$post = try { (Invoke-WebRequest -UseBasicParsing -Method Post "http://127.0.0.1:$port/").StatusCode } catch { [int]$_.Exception.Response.StatusCode }
Check 'read-only (POST is refused)' ($post -eq 405) "$post"

Write-Host 'Uninstalling'
Start-Process -Wait -FilePath (Join-Path $dir 'Uninstall DaVinci.exe') -ArgumentList '/S'
for ($i = 0; $i -lt 60 -and (Test-Path $exe); $i++) { Start-Sleep 1 }
Check 'files removed' (-not (Test-Path $exe))
Check 'server stopped' (-not (Get-Process DaVinci -ErrorAction SilentlyContinue) -and -not (Page))
Check 'Run key removed' ($null -eq (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).'DaVinci web server')
Check 'settings removed' (-not (Test-Path 'HKCU:\Software\DaVinci'))
Check 'firewall rule removed' ($null -eq (Rule))
Check '.davinci file type removed' (-not (Test-Path 'HKCU:\Software\Classes\.davinci'))

if ($failed) { Write-Host "$failed check(s) failed"; exit 1 }
Write-Host 'Installer checks passed'

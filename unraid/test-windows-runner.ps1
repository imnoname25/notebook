#Requires -Version 7.2
# Dependency-free tests. SSH is replaced with an in-memory stub; no connection to Unraid.
param([switch]$HookRejectionChild)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($HookRejectionChild) {
    # Never terminate a real worker, even if someone runs this suite inside the production runner.
    function global:Get-CimInstance { throw 'test-worker-lookup-disabled' }
    & "$PSScriptRoot/runner-job-started.ps1"
    exit $LASTEXITCODE
}
$files = @('runner-dispatch.ps1', 'runner-job-started.ps1', 'test-windows-runner.ps1')
foreach ($file in $files) {
    $tokens = $null
    $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file), [ref]$tokens, [ref]$errors)
    if ($errors.Count -ne 0) { throw "PowerShell parse failed: $file" }
}
. "$PSScriptRoot/runner-dispatch.ps1"
$script:passed = 0
function Assert-Check {
    param([bool]$Condition, [string]$Name)
    if (-not $Condition) { throw "Failed: $Name" }
    $script:passed++
}
function Assert-Denied {
    param([scriptblock]$Action, [string]$Name)
    $denied = $false
    try { & $Action } catch { $denied = $true }
    Assert-Check $denied $Name
}
$guide = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../docs/windows-runner.md') -Raw
foreach ($block in [regex]::Matches($guide, '(?ms)^```powershell\r?\n(.*?)^```')) {
    $tokens = $null
    $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseInput($block.Groups[1].Value, [ref]$tokens, [ref]$errors)
    Assert-Check ($errors.Count -eq 0) 'documented PowerShell commands parse without executing setup'
}
$context = @{
    GITHUB_REPOSITORY = 'imnoname25/notebook'
    GITHUB_WORKFLOW_REF = 'imnoname25/notebook/.github/workflows/unraid-production-approval.yml@refs/heads/main'
    GITHUB_EVENT_NAME = 'workflow_dispatch'
    GITHUB_REF = 'refs/heads/main'
    GITHUB_JOB = 'deliver'
    GITHUB_RUN_ID = '12345'
}
$original = @{}
foreach ($key in $context.Keys) { $original[$key] = [Environment]::GetEnvironmentVariable($key) }
try {
    foreach ($key in $context.Keys) { [Environment]::SetEnvironmentVariable($key, $context[$key]) }
    Assert-NotebookJob -ExpectedRunId '12345'
    Assert-Check $true 'manual deliver accepted'
    foreach ($value in @('', '0', '-1', '12345;whoami', "12345`n", '12345 extra', '$(whoami)', ('9' * 21), '１２３４５')) {
        Assert-Denied { Get-NotebookSshArguments -DispatchRunId $value } 'unsafe run ID denied'
    }
    Assert-Denied { Assert-NotebookJob -ExpectedRunId '999' } 'different run ID denied'
    foreach ($key in @('GITHUB_REPOSITORY', 'GITHUB_WORKFLOW_REF', 'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_JOB')) {
        [Environment]::SetEnvironmentVariable($key, 'untrusted')
        Assert-Denied { Assert-NotebookJob -ExpectedRunId '12345' } "wrong $key denied"
        [Environment]::SetEnvironmentVariable($key, $context[$key])
    }
    foreach ($event in @('pull_request', 'pull_request_target', 'push', 'workflow_run')) {
        $env:GITHUB_EVENT_NAME = $event
        Assert-Denied { Assert-NotebookJob -ExpectedRunId '12345' } 'non-dispatch job denied'
    }
    $env:GITHUB_EVENT_NAME = 'workflow_dispatch'
    $arguments = @(Get-NotebookSshArguments -DispatchRunId '12345')
    foreach ($required in @('StrictHostKeyChecking=yes', 'UpdateHostKeys=no', 'IdentitiesOnly=yes', 'IdentityAgent=none', 'BatchMode=yes', 'PasswordAuthentication=no', 'ClearAllForwardings=yes', 'ForwardAgent=no', 'ProxyCommand=none', 'UserKnownHostsFile=C:/ProgramData/NotebookDeploy/known_hosts', 'C:/ProgramData/NotebookDeploy/id_ed25519')) {
        Assert-Check ($arguments -ccontains $required) "required SSH option $required"
    }
    Assert-Check ($arguments[-2] -ceq 'notebook-production' -and $arguments[-1] -ceq 'dispatch 12345') 'fixed destination and single remote command'
    # WMI and process termination are mocked, including on the hosted Linux CI runner.
    $script:parentProcess = [pscustomobject]@{ Name = 'Runner.Worker.exe'; ExecutablePath = 'C:\actions-runner-notebook\bin\Runner.Worker.exe'; ProcessId = 123; ParentProcessId = 1 }
    function Get-CimInstance {
        param($ClassName, $Filter, $OperationTimeoutSec)
        if ($Filter -eq "ProcessId=$PID") {
            return [pscustomobject]@{ Name = 'pwsh.exe'; ExecutablePath = ''; ProcessId = $PID; ParentProcessId = 123 }
        }
        return $script:parentProcess
    }
    $script:stoppedId = 0
    function Stop-Process { param([int]$Id, [switch]$Force, $ErrorAction) $script:stoppedId = $Id }
    Stop-NotebookDeniedWorker
    Assert-Check ($script:stoppedId -eq 123) 'deny terminates only its parent worker'
    foreach ($name in @('Runner.Listener.exe', 'RunnerService.exe', 'unrelated.exe')) {
        $script:parentProcess = [pscustomobject]@{ Name = $name; ExecutablePath = ''; ProcessId = 123; ParentProcessId = 1 }
        $script:stoppedId = 0
        Assert-Denied { Stop-NotebookDeniedWorker } 'listener service and unrelated processes cannot be stopped'
        Assert-Check ($script:stoppedId -eq 0) 'non-worker remains untouched'
    }
    $script:parentProcess = [pscustomobject]@{ Name = 'Runner.Worker.exe'; ExecutablePath = 'C:\other-runner\bin\Runner.Worker.exe'; ProcessId = 123; ParentProcessId = 1 }
    Assert-Denied { Stop-NotebookDeniedWorker } 'other runner installations cannot be stopped'
    if ($IsWindows) {
        # -G prints effective configuration and exits WITHOUT opening a connection or reading keys.
        $ssh = Join-Path ([Environment]::GetFolderPath('Windows')) 'System32/OpenSSH/ssh.exe'
        $nativeArguments = @('-G') + $arguments.Clone()
        $nativeArguments[[Array]::IndexOf($nativeArguments, '-F') + 1] = 'NUL'
        $effective = & $ssh @nativeArguments 2>$null
        Assert-Check ($LASTEXITCODE -eq 0) 'built-in OpenSSH accepts native argument array without connecting'
        Assert-Check ([bool]($effective -match '^stricthostkeychecking (true|yes)$')) 'native host key checking remains strict'
        Assert-Check ([bool]($effective -match '^identityagent none$')) 'native SSH agent disabled'
    }
    $script:calls = 0
    $script:sshStatus = 0
    function Invoke-NotebookSsh {
        param([string[]]$SshArguments)
        $script:calls++
        Assert-Check ($SshArguments[-1] -ceq 'dispatch 12345') 'stub gets only validated command'
        return $script:sshStatus
    }
    Invoke-NotebookDispatch -DispatchRunId '12345'
    Assert-Check ($script:calls -eq 1) 'successful dispatch invokes SSH once'
    $script:sshStatus = 255
    Assert-Denied { Invoke-NotebookDispatch -DispatchRunId '12345' } 'SSH failure stops dispatch'
    Assert-Check ($script:calls -eq 2) 'no SSH retry'
    $env:GITHUB_EVENT_NAME = 'pull_request'
    Assert-Denied { Invoke-NotebookDispatch -DispatchRunId '12345' } 'PR rejected before SSH'
    Assert-Check ($script:calls -eq 2) 'denied context cannot invoke SSH'
    # Real child PowerShell process checks the hook's failure exit code, without calling SSH.
    $pwsh = (Get-Process -Id $PID).Path
    $PSNativeCommandUseErrorActionPreference = $false
    & $pwsh -NoLogo -NoProfile -NonInteractive -File "$PSScriptRoot/test-windows-runner.ps1" -HookRejectionChild 2>$null | Out-Null
    Assert-Check ($LASTEXITCODE -ne 0) 'job-start hook blocks PR before workflow steps'
    Write-Host "Windows runner safeguards: $script:passed checks passed; no SSH connection was made."
} finally {
    foreach ($key in $original.Keys) { [Environment]::SetEnvironmentVariable($key, $original[$key]) }
}
# The rejected child deliberately exits 1. Actions' pwsh wrapper propagates LASTEXITCODE even when
# every assertion succeeded, unlike `pwsh -File`. Report suite success only after assertions/cleanup.
exit 0

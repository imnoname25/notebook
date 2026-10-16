#Requires -Version 7.2
# Install reviewed copies outside the checkout in C:\ProgramData\NotebookDeploy (administrator owned).
[CmdletBinding()]
param([string]$RunId)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-NotebookJob {
    param([string]$ExpectedRunId)
    $required = @{
        GITHUB_REPOSITORY = 'imnoname25/notebook'
        GITHUB_WORKFLOW_REF = 'imnoname25/notebook/.github/workflows/unraid-production-approval.yml@refs/heads/main'
        GITHUB_EVENT_NAME = 'workflow_dispatch'
        GITHUB_REF = 'refs/heads/main'
        GITHUB_JOB = 'deliver'
    }
    foreach ($name in $required.Keys) {
        if ([Environment]::GetEnvironmentVariable($name) -cne $required[$name]) {
            throw 'deployment-job-required'
        }
    }
    if ($ExpectedRunId -cnotmatch '\A[1-9][0-9]{0,19}\z' -or $env:GITHUB_RUN_ID -cne $ExpectedRunId) {
        throw 'invalid-run-id'
    }
}

function Assert-NotebookWindowsIdentity {
    if (-not $IsWindows -or -not [Environment]::Is64BitProcess) {
        throw 'windows-x64-required'
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if ($identity.User.Value -eq 'S-1-5-18' -or $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'non-administrator-service-account-required'
    }
}

function Get-NotebookParentWorkerId {
    # Inspect only this hook's ancestors. Never stop a service, listener or an unrelated process.
    $ancestorId = $PID
    for ($depth = 0; $depth -lt 8; $depth++) {
        $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$ancestorId" -OperationTimeoutSec 5
        if ($null -eq $process) { break }
        if ($process.Name -ieq 'Runner.Worker.exe') {
            if ($process.ExecutablePath -ine 'C:\actions-runner-notebook\bin\Runner.Worker.exe') {
                throw 'unexpected-runner-worker-path'
            }
            return [int]$process.ProcessId
        }
        if ($process.Name -in @('Runner.Listener.exe', 'RunnerService.exe')) { break }
        if ($process.ParentProcessId -le 0 -or $process.ParentProcessId -eq $ancestorId) { break }
        $ancestorId = [int]$process.ParentProcessId
    }
    throw 'runner-worker-ancestor-required'
}

function Stop-NotebookDeniedWorker {
    $workerId = Get-NotebookParentWorkerId
    Stop-Process -Id $workerId -Force -ErrorAction Stop
}

function Get-NotebookSshArguments {
    param([string]$DispatchRunId)
    if ($DispatchRunId -cnotmatch '\A[1-9][0-9]{0,19}\z') { throw 'invalid-run-id' }
    @(
        '-T', '-n', '-F', 'C:/ProgramData/NotebookDeploy/ssh_config',
        '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no',
        '-o', 'UserKnownHostsFile=C:/ProgramData/NotebookDeploy/known_hosts',
        '-o', 'GlobalKnownHostsFile=NUL', '-o', 'IdentityAgent=none',
        '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no',
        '-o', 'PreferredAuthentications=publickey', '-o', 'ClearAllForwardings=yes',
        '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
        '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'ConnectTimeout=15',
        '-i', 'C:/ProgramData/NotebookDeploy/id_ed25519',
        'notebook-production', "dispatch $DispatchRunId"
    )
}

function Invoke-NotebookSsh {
    param([string[]]$SshArguments)
    Assert-NotebookWindowsIdentity
    # Never resolve ssh.exe through PATH, Git, a checkout or WSL.
    $ssh = Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\OpenSSH\ssh.exe'
    foreach ($path in @($ssh, 'C:\ProgramData\NotebookDeploy', 'C:\ProgramData\NotebookDeploy\ssh_config', 'C:\ProgramData\NotebookDeploy\known_hosts', 'C:\ProgramData\NotebookDeploy\id_ed25519')) {
        $item = Get-Item -LiteralPath $path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'reparse-point-denied' }
    }
    # Inspect the native status explicitly, also on PowerShell versions with native error preferences.
    $PSNativeCommandUseErrorActionPreference = $false
    & $ssh @SshArguments | Out-Host
    return $LASTEXITCODE
}

function Invoke-NotebookDispatch {
    param([string]$DispatchRunId)
    Assert-NotebookJob -ExpectedRunId $DispatchRunId
    $status = Invoke-NotebookSsh -SshArguments (Get-NotebookSshArguments -DispatchRunId $DispatchRunId)
    if ($status -ne 0) { throw 'ssh-delivery-failed' }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        if ($args.Count -ne 0) { throw 'unexpected-arguments' }
        Invoke-NotebookDispatch -DispatchRunId $RunId
        exit 0
    } catch {
        # No environment dumps, exception contents, key material, retries or fallback authentication.
        [Console]::Error.WriteLine('Notebook dispatch rejected or SSH delivery failed. Check protected local configuration.')
        exit 1
    }
}

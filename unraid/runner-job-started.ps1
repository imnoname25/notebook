#Requires -Version 7.2
# Mandatory local pre-job hook. Install outside actions-runner and every repository checkout.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
    . "$PSScriptRoot\runner-dispatch.ps1"
    Assert-NotebookJob -ExpectedRunId $env:GITHUB_RUN_ID
    Assert-NotebookWindowsIdentity
    $null = Get-NotebookParentWorkerId
    Write-Host 'Notebook deployment job accepted by local runner policy.'
    exit 0
} catch {
    [Console]::Error.WriteLine('Runner policy denied this job before workflow steps.')
    # A failed pre-step alone can be followed by a malicious `if: always()` step.
    # Terminate ONLY our own fixed-path parent worker so it cannot evaluate further steps.
    try { Stop-NotebookDeniedWorker } catch {
        [Console]::Error.WriteLine('Worker stop was unavailable; runner isolation must be checked locally before enabling production.')
    }
    exit 1
}

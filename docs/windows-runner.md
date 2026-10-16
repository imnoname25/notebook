# Windows x64 runner для ручного deployment Notebook

Это инструкция первоначальной настройки, **не выполненная автоматически этой задачей**.
Не регистрировать/включать production runner до review и отдельного разрешения владельца.
`execution_enabled` на Unraid и `UNRAID_DEPLOY_ENABLED` в GitHub остаются выключенными.
Python engine, backup/restore, forced-command и Environment `production` работают по
[основному runbook](unraid-production.md). WSL, Docker Desktop, Git Bash и Python на Windows не нужны.

## Граница доверия и ограничения jobs

Workflow `unraid-production-approval.yml` остаётся manual-only. Validate/approve — GitHub-hosted
Ubuntu; только deliver — `[self-hosted, windows, x64, notebook-deploy]`, `shell: pwsh`, без checkout,
actions из репозитория, Downloads или пакетов на production runner. Шаг вызывает только установленный
администратором `C:\ProgramData\NotebookDeploy\runner-dispatch.ps1` с run ID.

Обязателен локальный **job-start hook** `runner-job-started.ps1`. Он принимает только repository
`imnoname25/notebook`, event `workflow_dispatch`, ref `refs/heads/main`, точный workflow ref и job
`deliver`. Другие jobs, включая `pull_request`, `pull_request_target`, push/build, завершаются ошибкой
**до workflow steps**. Это штатный [GitHub pre-job hook](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts).
Hook не выполняет SSH и не заменяет независимый approval на Unraid.
Одного nonzero hook exit недостаточно как security boundary: последующий step с `if: always()`
может оцениваться runner. Поэтому отказ **завершает только родительский Runner.Worker.exe** из
фиксированного `C:\actions-runner-notebook\bin`, без остановки Listener/службы/посторонних процессов.
Разрешённая job тоже проверяет доступность этого механизма. Службу нельзя устанавливать в другой
каталог без review adapter. До подтверждения этой проверки на VM production оставлять выключенным.
Основание усиления — последовательность pre-job/main steps в
[runner JobExtension](https://github.com/actions/runner/blob/main/src/Runner.Worker/JobExtension.cs)
и [обработка условий StepsRunner](https://github.com/actions/runner/blob/main/src/Runner.Worker/StepsRunner.cs).

Labels только маршрутизируют, не запрещают назначение job. Где доступны organization/enterprise
runner groups, дополнительно выбрать **Selected repositories** и **Selected workflows**:
`imnoname25/notebook/.github/workflows/unraid-production-approval.yml@refs/heads/main`.
Не предполагать наличие groups у персонального repository; [доступность проверяется администратором](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/manage-access).
Без groups чужая job может попасть в очередь runner, но защищённый hook блокирует её шаги.
Это не platform-side запрет назначения. Если нужен именно такой запрет, production не включать
до выбора поддерживаемой runner group/организационной схемы; перенос репозитория автоматически не делать.

Защитить main/workflows review/ruleset. Hook, launcher, SSH config, known_hosts и runner `.env`
не должны быть доступны runner на запись/удаление. Не использовать VM для исполнения недоверенного
кода, не давать service account права администратора и не запускать службу как LocalSystem.
Компрометация администратора VM/разрешённого workflow выходит за границу hook; public repository
сохраняет [риски self-hosted runner](https://docs.github.com/en/actions/reference/security/secure-use).
Изолировать VM: исходящие GitHub HTTPS/DNS/NTP и LAN SSH только к `192.168.110.11`, без доступа к
PostgreSQL, Docker API, admin UI и остальной LAN. Не открывать входящий SSH/RDP/WAN ради runner.

## 1. Prerequisites и service account

Все команды настройки ниже — **из elevated PowerShell**, после разрешения владельца.
Windows x64, установка PowerShell 7 machine-wide и встроенного OpenSSH **Client**, не Server:

```powershell
winget install --id Microsoft.PowerShell --exact --source winget --scope machine
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile
```

Дальше выполнять в открытом **PowerShell 7**. Проверить machine PATH для службы, не только User PATH:

```powershell
$ErrorActionPreference = 'Stop'
$PSVersionTable.PSVersion
& "$env:WINDIR\System32\OpenSSH\ssh.exe" -V
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if (($machinePath.Split(';').TrimEnd('\')) -notcontains 'C:\Program Files\PowerShell\7') {
    [Environment]::SetEnvironmentVariable('Path', $machinePath + ';C:\Program Files\PowerShell\7', 'Machine')
}
$account = "$env:COMPUTERNAME\NotebookRunner"
$null = New-LocalUser -Name NotebookRunner -Password (Read-Host 'New service account password' -AsSecureString) -Description 'Notebook deployment runner'
$runnerSid = (Get-LocalUser -Name NotebookRunner).SID.Value
```

Не добавлять пользователя в Administrators, Docker groups или право интерактивного RDP.
Проверить local policy: Log on as a service; конфигуратор GitHub может назначить это право.
Срок/ротацию пароля service account согласовать с Windows policy, иначе истечение остановит службу.
Не вводить пароли/registration token прямо в аргументы/history/transcript.

## 2. Защищённые scripts и SSH

`C:\Project\Note` должен содержать проверенный commit. Следующие команды рассчитаны на **новую**
установку; существующие ключи/config не перезаписывать. Для ACL используются SID, независимо от языка Windows.

```powershell
$control = 'C:\ProgramData\NotebookDeploy'
$null = New-Item -ItemType Directory -Path $control

function Set-NotebookAcl {
    param([string]$Path, [string]$RunnerRights = 'ReadAndExecute')
    $directory = (Get-Item -LiteralPath $Path -Force).PSIsContainer
    $acl = if ($directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = if ($directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($entry in @(@('S-1-5-32-544', 'FullControl'), @('S-1-5-18', 'FullControl'), @($runnerSid, $RunnerRights))) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($entry[0]),
            [Security.AccessControl.FileSystemRights]$entry[1], $inherit,
            [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}
Set-NotebookAcl $control
Copy-Item -LiteralPath 'C:\Project\Note\unraid\runner-dispatch.ps1' -Destination $control
Copy-Item -LiteralPath 'C:\Project\Note\unraid\runner-job-started.ps1' -Destination $control
Copy-Item -LiteralPath 'C:\Project\Note\unraid\runner-ssh-config.windows.example' -Destination "$control\ssh_config"
$unraidSshPort = [int](Read-Host 'Verified actual Unraid LAN SSH port')
if ($unraidSshPort -lt 1 -or $unraidSshPort -gt 65535) { throw 'Invalid SSH port' }
(Get-Content -LiteralPath "$control\ssh_config" -Raw).Replace('REPLACE_WITH_ACTUAL_LAN_SSH_PORT', [string]$unraidSshPort) |
    Set-Content -LiteralPath "$control\ssh_config" -Encoding utf8NoBOM
& "$env:WINDIR\System32\OpenSSH\ssh-keygen.exe" -t ed25519 -f "$control\id_ed25519" -C notebook-deploy-windows
if ($LASTEXITCODE -ne 0) { throw 'Key generation failed' }
```

Для отдельного unattended key при запросе passphrase нажать Enter дважды: ключ без passphrase
защищается NTFS ACL и server forced-command. Это отдельный ключ только для этой цели; не использовать
личный ключ и не подключать ssh-agent. Альтернативный secret store потребует отдельного adapter review.
Ни `DATABASE_URL`, ни `SETTINGS_ENCRYPTION_KEY`, ни PG password на VM не копировать.

Из **доверенной консоли Unraid** получить fingerprint:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256
```

Только после этого на VM собрать candidate host key и сверить SHA256 **вручную** с консолью:

```powershell
& "$env:WINDIR\System32\OpenSSH\ssh-keyscan.exe" -p $unraidSshPort -t ed25519 192.168.110.11 |
    Set-Content -LiteralPath "$control\known_hosts.candidate" -Encoding ascii
if ($LASTEXITCODE -ne 0) { throw 'Host key collection failed' }
& "$env:WINDIR\System32\OpenSSH\ssh-keygen.exe" -lf "$control\known_hosts.candidate" -E sha256
# STOP: compare with the trusted console fingerprint before the next command.
# A successful keyscan is not identity verification. Never accept a mismatch.
Move-Item -LiteralPath "$control\known_hosts.candidate" -Destination "$control\known_hosts"
foreach ($name in @('runner-dispatch.ps1', 'runner-job-started.ps1', 'ssh_config', 'known_hosts', 'id_ed25519.pub')) {
    Set-NotebookAcl "$control\$name"
}
Set-NotebookAcl "$control\id_ed25519" -RunnerRights Read
Get-Acl -LiteralPath "$control\id_ed25519" | Select-Object Owner,AccessToString
```

Owner — Administrators, полный доступ только SYSTEM/Administrators, runner — Read; никому другому
не давать доступ. Parent directory также read-only для runner, включая отсутствие DeleteChild.
Правила private-key ownership проверяются [Windows OpenSSH](https://github.com/PowerShell/openssh-portable/blob/latestw_all/contrib/win32/win32compat/w32-sshfileperm.c).
Не отключать StrictHostKeyChecking и не использовать accept-new, `NUL` для UserKnownHostsFile или
динамическое доверие keyscan. Launcher фиксирует именно protected known_hosts и отключает global
known_hosts/agent/password auth/forwarding/proxy. При смене host key нужна новая доверенная сверка.

На Unraid установить **public** `id_ed25519.pub` по исходному runbook с actual LAN IP Windows VM:

```text
from="<WINDOWS_VM_LAN_IP>",restrict,command="/mnt/user/appdata/notebook-deploy-control/forced-command.sh" ssh-ed25519 <PUBLIC_KEY> notebook-deploy-windows
```

Сохранить forced-command и его root-owned Python gateway. Только LAN SSH с VM, не WAN.

## 3. Runner как Windows-служба

Получить Windows x64 package из [официального actions/runner release](https://github.com/actions/runner/releases).
Команды используют актуальный release и проверяют опубликованный SHA-256 **до распаковки**:

```powershell
$runnerRoot = 'C:\actions-runner-notebook'
$null = New-Item -ItemType Directory -Path $runnerRoot
$release = Invoke-RestMethod 'https://api.github.com/repos/actions/runner/releases/latest'
$asset = @($release.assets | Where-Object name -Match '^actions-runner-win-x64-[0-9.]+\.zip$')
if ($asset.Count -ne 1 -or $asset[0].digest -cnotmatch '\Asha256:[0-9a-f]{64}\z') { throw 'Verified runner asset required' }
$zip = Join-Path $runnerRoot $asset[0].name
Invoke-WebRequest -Uri $asset[0].browser_download_url -OutFile $zip
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $asset[0].digest.Substring(7)) { throw 'Runner checksum mismatch' }
Expand-Archive -LiteralPath $zip -DestinationPath $runnerRoot
Set-Content -LiteralPath "$runnerRoot\.env" -Encoding ascii -Value 'ACTIONS_RUNNER_HOOK_JOB_STARTED=C:\ProgramData\NotebookDeploy\runner-job-started.ps1'
Set-Location -LiteralPath $runnerRoot
.\config.cmd --url https://github.com/imnoname25/notebook --name notebook-deploy-win --labels notebook-deploy --work _work --disableupdate --runasservice --windowslogonaccount $account
if ($LASTEXITCODE -ne 0) { throw 'Runner service configuration failed' }
```

Конфигуратор интерактивно запросит временный registration token (GitHub Settings → Actions → Runners
→ New self-hosted runner → Windows x64) и пароль service account. Token не передавать в CLI и не
сохранять в repo/transcript. Default labels добавляют `self-hosted`, `Windows`, `X64` автоматически;
custom label — `notebook-deploy`. Не использовать `--replace`, чтобы не затереть чужой runner.
Для organization runner group использовать соответствующий **organization URL** и `--runnergroup`
только после реальной настройки Selected workflows; не считать repository runner автоматически групповым.

Windows service устанавливается именно через `config.cmd --runasservice`, не через `svc.sh`:
[официальная инструкция GitHub](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application?platform=windows).
Пока switches выключены, остановить службу и закрыть ACL конфигурации/бинарников:

```powershell
$service = @(Get-CimInstance Win32_Service | Where-Object { $_.PathName -like '*C:\actions-runner-notebook\bin\RunnerService.exe*' })
if ($service.Count -ne 1) { throw 'Unexpected runner service' }
$serviceSid = ([Security.Principal.NTAccount]::new($service[0].StartName)).Translate([Security.Principal.SecurityIdentifier]).Value
if ($serviceSid -ne $runnerSid) { throw 'Unexpected runner service identity' }
Stop-Service -Name $service[0].Name
Set-NotebookAcl $runnerRoot
# Existing files may have inherited ACLs from before registration; replace them explicitly.
Get-ChildItem -LiteralPath $runnerRoot -Recurse -Force | ForEach-Object { Set-NotebookAcl $_.FullName }
foreach ($name in @('_work', '_diag')) {
    $path = Join-Path $runnerRoot $name
    if (-not (Test-Path -LiteralPath $path)) { $null = New-Item -ItemType Directory -Path $path }
    Set-NotebookAcl $path -RunnerRights Modify
    Get-ChildItem -LiteralPath $path -Recurse -Force | ForEach-Object { Set-NotebookAcl $_.FullName -RunnerRights Modify }
}
Start-Service -Name $service[0].Name
Get-Service -Name $service[0].Name
```

Бинарники/root/.env защищены от записи и удаления runner; writable только `_work` и `_diag`.
Если ваша версия runner требует дополнительный writable runtime path, проверить его назначение
на стенде и дать доступ только к нему, не ко всему root. `--disableupdate` выбран именно из-за
admin-owned бинарников: обновление делает администратор, с остановкой службы и проверкой SHA.
Нельзя оставлять версию устаревшей: [GitHub требует обновлять отключённый auto-update runner](https://docs.github.com/en/actions/reference/runners/self-hosted-runners).

## 4. Проверки перед включением

```powershell
& 'C:\Program Files\PowerShell\7\pwsh.exe' -NoLogo -NoProfile -NonInteractive -File C:\Project\Note\unraid\test-windows-runner.ps1
```

Тесты не подключаются к Unraid. Проверяют parser, allowlist workflow/event/ref/job/run ID, host key
options, SSH failure/no retry; на Windows штатный `ssh.exe -G` проверяет native argument parsing
без сети. Поиск worker и Stop-Process в suite заменены mocks; реальные процессы не завершаются.
На hosted Ubuntu тот же dependency-free suite выполняется Docker CI до публикации.
Реальную установку службы/ACL/отказ в записи проверять отдельно из service identity на VM.

Убедиться, что служба видит pwsh 7, hook появляется в Set up runner и запрещённый job завершает
работу **до пользовательских шагов**. Эту проверку выполнять с безопасным тестовым job без недоверенного
кода и без SSH, включая harmless `if: always()` marker: он не должен выполниться после отказа.
Проверить, что остановлен только назначенный Worker, а Listener/служба продолжают работать.
Не запускать untrusted PR для проверки защиты. Group restrictions проверить отдельно.
Если hook/ACL не подтверждены, не включать production.

Изменился YAML manual workflow: на Unraid вручную обновить только соответствующий проверенный
`trusted_control_hashes` после review. Без этого gateway правильно отклонит новый запуск.
Python engine и `execution_enabled` не менять. Environment `production`/required reviewers,
проверенный backup, SQL review/rehearsal и rollback restrictions остаются прежними.
Включение обоих switches и первый реальный deployment — только отдельной командой владельца.

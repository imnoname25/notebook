# Docker CI: диагностика runs #30–35

Проверено 26 октября 2026. Исходный main и origin/main совпадали на
`a2e0018fda86d9b1c8699e8ddc0ad2803ab6f4a9`; рабочее дерево было чистым.
Источник выводов — скачанные Actions logs, jobs/check-run annotations и GHCR Registry API,
а не предположение по длительности или успешный локальный build.

## Подтверждённые причины

| Run | SHA | Результат и причина |
| --- | --- | --- |
| [#29](https://github.com/imnoname25/notebook/actions/runs/38857889005) | a589590 | validate, smoke и multi-arch publish прошли |
| [#30](https://github.com/imnoname25/notebook/actions/runs/38862054947) | b1c3d2e | backup-storage.test.ts: `rejects C:\secret.zip` не получил ожидаемую ошибку на Linux |
| [#31](https://github.com/imnoname25/notebook/actions/runs/38875089567) | be89835 | та же регрессия проверки Windows-пути на POSIX |
| [#32](https://github.com/imnoname25/notebook/actions/runs/38878508610) | d708262 | та же регрессия |
| [#33](https://github.com/imnoname25/notebook/actions/runs/38881052085) | d9451e1 | та же регрессия |
| [#34](https://github.com/imnoname25/notebook/actions/runs/38884940273) | 5ff09cd | 55 PowerShell assertions прошли, но Actions pwsh wrapper вернул оставшийся LASTEXITCODE=1 ожидаемо отклонённого child process |
| [#35](https://github.com/imnoname25/notebook/actions/runs/38885458209) | a2e0018 | отменён пользователем после успешных шагов публикации; образ уже находился в GHCR |

Windows `path.basename/isAbsolute` и POSIX трактуют `C:\secret.zip` по-разному.
Коммит `5ff09cd` уже исправил проверку обеих грамматик и расширил регрессионные тесты,
не ослабляя защиту от traversal/symlink. Заново менять backup storage для Docker CI не нужно.

Коммит `a2e0018` уже исправил итоговый exit code PowerShell suite: success возвращается
только после успешных assertions и восстановления окружения. Отрицательный тест дочернего
процесса сохранён. Локально suite выполнил 58 проверок на Windows, без SSH-соединения;
в #35 — 55 на Linux (Windows-only OpenSSH -G проверки там не выполняются).

## Почему #35 cancelled, хотя push состоялся

Check-run `116925957362`, endpoint `/annotations`, содержит:

> The run was canceled by @imnoname25.

Это явная отмена пользователем, не concurrency: в workflow `cancel-in-progress: false`.
До настроенного publish timeout 60 минут job также не дошёл. Доступные данные указывают
пользователя, но не различают клик в UI, GitHub CLI или другой API-клиент.

Push четырёх manifest tags завершился 16 октября в 10:46:38 UTC; image artifact сохранён
в 10:46:41 UTC; cleanup завершился в 10:47:34 UTC; общий run получил cancelled в 10:47:37 UTC.
Предупреждение QEMU cache `Unable to reserve cache ... another job may be creating this cache`
не являлось причиной: соответствующий post-step завершился success.

Отдельно прочитаны registry manifests четырёх tags:

- `ghcr.io/imnoname25/notebook:main`;
- `ghcr.io/imnoname25/notebook:edge`;
- `ghcr.io/imnoname25/notebook:sha-a2e0018`;
- `ghcr.io/imnoname25/notebook:sha-a2e0018fda86d9b1c8699e8ddc0ad2803ab6f4a9`.

Все указывали на:

```text
sha256:d4e9b02b3dfc3b05991336c3eded2f9688896dfca9d5070551bc1284ada4f308
```

Index содержит `linux/amd64`, `linux/arm64` и два attestation manifests
с `unknown/unknown` (служебные descriptors, не дополнительные runtime architectures).
Это доказательство публикации #35, но не основание объявлять весь run зелёным.

## Изменения CI

1. В publish был только `cache-from` для `notebook-multiarch`, без exporter.
   Добавлен соответствующий `cache-to`, чтобы последующие сборки могли использовать результаты.
   Cache export — оптимизация: `ignore-error=true` относится только к этому exporter,
   а не к тестам, security scan, сборке или проверке registry. Длительность первой сборки
   без кэша не считается сбоем и не имеет обещанного ускорения.
2. После push workflow читает обратно GHCR через аутентифицированный
   `docker buildx imagetools inspect`, проверяет digest index, обе архитектуры и каждый
   опубликованный tag. Несовпадение останавливает job до source/digest artifact.
3. Summary публикует проверенный digest, платформы и tags и отдельно напоминает
   проверять итоговый conclusion run: отмена после push не удаляет образ из registry.
4. Регрессионный contract test сохраняет цепочку `validate → smoke → publish`, запрет
   публикации из PR, runtime restart/readiness checks, provenance и SBOM. Тесты и security
   gates не отключались, permissions и production channel не расширялись.

Локальный последовательный прогон также выявил неверное место настройки timeout в
`scripts/release.test.mjs`: suite option `hookTimeout` не применялся к `beforeEach`,
и Git fixture иногда превышал стандартные 10 секунд. Исходно задуманные 30 секунд
переданы непосредственно в `beforeEach`; assertions и отрицательные сценарии сохранены.

Формат существующего `image.json` не меняется. `latest` по-прежнему публикуется только
для stable release tag; push main обновляет main/edge/SHA tags. Release tag не создаётся.
Production workflow, Unraid tooling/config, SSH, runner setup, Dockerfile, PostgreSQL
и миграции в этой задаче не меняются.

## Локальная проверка и ограничения

Запускаются lint, typecheck, unit tests, Next.js production build, version check,
Docker/Unraid packaging validators, Python safeguard tests и PowerShell suite.
Unit tests: 237 passed, 36 skipped (в том числе проверки с отдельной БД и Windows file-symlink без нужной привилегии).
PowerShell suite: 58 checks, Python safeguards: 42 tests.
Дополнительно actionlint проверяет workflow; registry verification проверена на корректном
multi-arch fixture и на отказ при отсутствии arm64 или несовпадении tag digest.

На локальном Windows нет Docker CLI/engine: `docker compose config` и реальный Docker
build/healthcheck локально недоступны. Обязательный hosted Linux smoke job остаётся
перед публикацией. PostgreSQL integration/E2E без отдельной тестовой БД не выдаются за пройденные.

Локальная оболочка содержала лишнюю кавычку в PATH после `dotnet`, ломавшую вызов quoted
`node` из npm .cmd shims. Исправлялся только PATH дочерних проверочных процессов;
системные настройки и execution policy не менялись. Используется `npm.cmd`.

Финальные SHA, номер нового run, его conclusion и опубликованный digest нужно проверять
после push в Actions и GHCR; успешный local build этого не подтверждает.

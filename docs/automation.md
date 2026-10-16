# Git, CI и релизы Notebook

Основная ветка — `main`, remote — `https://github.com/imnoname25/notebook`.
Правила завершения задач Codex находятся в [AGENTS.md](../AGENTS.md): review status/diff,
проверки, поиск секретов, коммит только текущей задачи и обычный `git push origin main`.
Ошибки проверок останавливают commit/push; недоступные локальные проверки явно перечисляются
в отчёте и не считаются успешными. Публикация образов/релизных assets требует всех CI gates. Это инструкции
агенту, а не обход GitHub branch protection; права пользователя и правила репозитория действуют.

## Существующие workflow

Новые workflow не создаются. В `.github/workflows` остаются два файла:

| Событие | Docker image | Android client |
| --- | --- | --- |
| PR в main | Web checks, packaging validators, Docker/PostgreSQL smoke test; без публикации | Client checks, Gradle debug lint/tests, APK artifact |
| Push в main | Те же проверки, затем multi-arch GHCR | Те же проверки, debug APK в Actions Artifacts |
| Stable tag vX.Y.Z | Проверка версии, проверки и smoke, затем release image tags | Проверка версии, debug checks, web checks, signed release lint/tests/APK/AAB, GitHub Release |
| Ручной workflow_dispatch | Проверки; публикация Docker только на main или stable release tag | Debug checks; release job только на stable release tag |

Node.js 24 соответствует Dockerfile. Android использует Java 21, AGP 8.13.0,
Gradle Wrapper 8.14.3, compile/target SDK 36 и Build Tools 35.0.0 (default AGP 8.13).
CI вызывает wrapper проекта, а не произвольный установленный Gradle.
Debug job намеренно вызывает `lintDebug testDebugUnitTest`: общий `test` может
сконфигурировать release tasks, которым проект требует signing secrets.

`setup-android@v3` получает явный список
`platform-tools platforms;android-36 build-tools;35.0.0`, исключающий legacy пакет `tools`.
Основания: [inputs setup-android](https://github.com/android-actions/setup-android/blob/v3/action.yml)
и [совместимость AGP 8.13](https://developer.android.com/build/releases/agp-8-13-0-release-notes?hl=en).

Оба workflow проверяют новые коммиты Gitleaks 8.24.3 с redaction до публикации.
Для обычного push сканируется диапазон от `before` до HEAD, для PR — от base до merge HEAD;
при создании нового ref сканируется его доступная история. Для workflow_dispatch — последний коммит.
Сканер не доказывает отсутствие всех возможных секретов: ручной review staged diff обязателен.
Workflow не передаёт production secrets в Docker build. Job permissions по умолчанию — read;
`packages: write` предоставляется только Docker publish, `contents: write` — Android release.
Concurrency сериализует запуски одного ref без отмены уже начавшейся публикации.

GHCR сохраняет существующие `edge`, `latest`, version tags и короткий `sha-*`.
Дополнительно публикуются `main` и `sha-<полный 40-символьный SHA>`.
`main`/`edge` обновляются только веткой main, `latest` — только стабильным релизом.
Unraid XML и Compose по-прежнему используют `latest`; их production channel не переключается.
Для production обновления и отката фиксируйте digest, поскольку tags можно переместить.

## Настройка GitHub

GHCR использует штатный `GITHUB_TOKEN`: разрешите Actions создавать/обновлять пакет
`ghcr.io/imnoname25/notebook`, при необходимости свяжите существующий пакет с репозиторием.
Для private image на Unraid потребуется отдельный read-only `read:packages` credential.
Состояние настроек GitHub и наличие secrets нужно проверить администратору; значения не читать в чат.

Для подписания Android нужны существующие Repository Actions Secrets:

- `ANDROID_KEYSTORE_BASE64` — существующий keystore в base64;
- `ANDROID_KEYSTORE_PASSWORD`;
- `ANDROID_KEY_ALIAS`;
- `ANDROID_KEY_PASSWORD`.

Ключи не заменять: смена signing identity нарушит обновления уже установленных APK.
Keystore восстанавливается с правами только владельца во временной директории runner,
удаляется шагом `always()`, пароли передаются только через env. Debug build secrets не нужны.
Подписи APK/AAB проверяются перед upload; GitHub Release содержит `Notebook-X.Y.Z.apk` и `.aab`.

Рекомендуется запретить force push и удаление main/release tags в GitHub rulesets.
Если main требует PR, не ослаблять защиту ради agent push: использовать разрешённый процесс PR.

## Создание релиза — только отдельной командой

1. По явной просьбе о новой версии выполнить `npm run version:set -- X.Y.Z`.
   Helper синхронизирует оба package.json, оба lock-файла, Android versionName и повышает versionCode.
   Проверить изменения, пройти проверки, закоммитить и отправить main. Дождаться обоих зелёных workflow.
2. Для просмотра плана: `npm run release -- vX.Y.Z`. Команда только читает локальное состояние;
   чистый main должен совпадать с локальным origin/main. План не запускает сборки и не создаёт tag.
3. Только после отдельного разрешения создать релиз:
   `npm run release -- vX.Y.Z --publish`.

Для publish локально нужны Node.js 24/npm, Java 21/Android SDK, Gitleaks и доступ к GitHub.
Команда fetch-ит main/tags, требует чистый main на origin/main, проверяет синхронизацию
package/lock/Gradle versions, отсутствие tag, рост semver и versionCode относительно прежних
stable tags. Затем запускает web lint/typecheck/tests/build, Docker/Unraid validators,
Gitleaks и Android client/debug lint/tests/APK. Любая ошибка прерывает создание tag.
Повторный fetch защищает от изменения main за время проверок. После этого создаётся annotated
tag ровно на проверенном SHA и отправляется только `refs/tags/vX.Y.Z`, без force.

Push tag из локального Git запускает оба существующих workflow. Он не использует
`GITHUB_TOKEN` внутри workflow для создания tag: такие события обычно не запускают другие workflow.
Если push tag не прошёл, локальный tag сохраняется: проверить remote и причину, затем отправить
тот же tag; не перемещать и не удалять уже опубликованный release tag для исправления сборки.

Оба workflow независимы: Android Release может появиться до завершения Docker publish.
Релиз готов к установке только после успеха ОБОИХ workflow и проверки GHCR digest + assets.
При частичном сбое исправить причину и безопасно перезапустить failed job на том же SHA;
если требуется изменение исходников — выпустить новую версию. Production не обновляется автоматически.

## Unraid

Порядок проверки миграций, backup, обновления и отката — в [UNRAID.md](../UNRAID.md).
`docker-compose.update.yml` — opt-in overlay для уже существующего Compose deployment,
с обязательным `NOTEBOOK_UPDATE_IMAGE` (digest). Для обычных XML installations использовать
тот же digest в поле Repository существующего контейнера, сохраняя все mappings/env.
Ни CI, ни release helper не подключаются к Unraid, не применяют production migrations
и не содержат deploy credentials. Новых runtime secrets/env нет; optional
`NOTEBOOK_UPDATE_IMAGE` описан в `.env.example`.

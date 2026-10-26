# Актуализация Android APK после Studio 2.1

## Что установлено

База — `61c6445b191336c0e64a7fe55a7bb6b412a583c5`; main и origin/main совпадали.
[Android CI базы](https://github.com/imnoname25/notebook/actions/runs/40298424045) завершился
успешно. Его APK скачан и проверен локально. ADB не обнаружил подключённых устройств;
версия/сертификат установленного на Fold приложения не считывались.

У Capacitor **нет `server.url`**. Однако это не означает встроенный интерфейс заметок:
`webDir: www` содержит только chooser/bootstrap. `www/app.js` проверяет выбранный endpoint,
затем выполняет `window.location.replace(notebookUrl(server))` и открывает удалённый `/app`.
В assets базового APK только app.js, server-url.js, styles.css, index.html, icon и Cordova stubs.
Studio CSS, BlockNote и DocumentTabs **в APK не встроены**. Они приходят с выбранного сервера.

Поэтому пункт «новые темы и вкладки присутствуют в APK» в существующей архитектуре выполнить
буквально нельзя. Исходники main содержат Studio 2.1, но новая Android-оболочка не обновляет
удалённый Next.js. Если выбранный сервер обслуживает старую сборку, новый APK покажет старый
интерфейс. Server deployment, конфигурация сервера, Docker и Unraid в этой задаче не менялись.

Дополнительно найден подтверждённый дефект маркировки: Android versionName был 0.6.0 (code 6),
а встроенный app.js сообщал удалённому интерфейсу CURRENT_VERSION=0.2.0. Поэтому показанную
в старом веб-UI версию нельзя было использовать как доказательство возраста APK.

## Изменения

- Нативный `NotebookAppInfo` отдаёт versionName/versionCode, полный source SHA, dirty flag
  и debug/release. Значения включаются Gradle из фактического checkout, не из URL.
- Debug versionName имеет суффикс `-g<8 символов SHA>`, видимый также в Android App info.
  Shared version остаётся 0.6.0, versionCode — 6. applicationId — `ru.metroom.notebook`.
- Встроенный экран показывает сведения о сборке и передаёт корректную базовую версию и
  публичный SHA в /app query. При недоступном native bridge версия не выдумывается;
  запрос metadata ограничен по времени и не блокирует подключение навсегда.
- Новое веб-UI показывает native identity в **Настройки → Оформление**, для любой роли.
  На ещё не обновлённом сервере этот новый блок появиться сам не может.
- Независимый от сервера способ: удержать значок Notebook в launcher → **О сборке**.
  Открывается native dialog с полным SHA. Он не читает URL, cookies, заметки или storage.
- Capacitor android/core/cli обновлены с 8.5.0 до 8.5.3. Исправлена подтверждённая
  [уязвимость native runtime](https://github.com/advisories/GHSA-rvm3-566m-v7fv).
  Без force-update исправлены high transitive dependencies; для CLI xcode helper применяется
  scoped uuid 11.1.1 override. Его фактический uuid.v4 CJS call проверяется check-app-info.
  `npm audit` Android-клиента: 0 vulnerabilities, включая dev dependencies.

Не менялись CSS/дизайн, viewport, WebView scale, app data directory, cookie policy, API,
PostgreSQL, signing configuration, applicationId или GitHub workflows. JavaScript/DOM storage
включены стандартным Capacitor bridge. MainActivity не задаёт textZoom/initialScale или
нестандартный wide-viewport. Main viewport: device-width, initialScale 1, cover и
interactiveWidget=resizes-content; bootstrap использует device-width/initialScale 1/cover.
Реальный WebView version, DPI, fontScale и поведение IME требуют проверки на устройстве.

## Подпись и обновление без удаления данных

Найден старый локальный `app-debug.apk` с датой 21 августа: **0.5.0 (5)**, тот же applicationId.
До перезаписи его копия сохранена в ignored `.cache/android-audit/workspace-previous.apk`.
Сертификаты SHA-256:

| APK | SHA-256 сертификата |
| --- | --- |
| Старый локальный 0.5.0 | `6bb95d5b5ff02dc79ebaa430ae01e56329b855984846229fd789328cd39356fb` |
| Локальный существующий debug key / новый APK | `6e6480d2d68ca8307219ab7b37e4f17e8fe954b7a82e1d119a90cd65311b6a5c` |
| GitHub debug artifact базы 61c6445 | `a24fd5273e851cc09774241254b804ed5c983905e6c225a821f749a5ac1caf2e` |

Ключи не заменялись и новый release key не создавался. Использован уже существовавший
`%USERPROFILE%\.android\debug.keystore`. Он отличается от ключа старого локального APK.
Следовательно, **обновить именно этот старый APK новым локальным файлом поверх нельзя**.
Наличие одинакового package ID само по себе недостаточно: нужен прежний signing key.
Это [требование Android](https://developer.android.com/studio/publish/app-signing).
В текущей среде release signing secrets не заданы. Исходного ключа старого APK в проекте
не найдено. Был запрошен путь к нему; пароли в чат не запрашивались.

Установленный на Fold APK может иметь другой источник; без устройства его сертификат
не подтверждён. Практическое сохранение cookies/localStorage/Keystore при update не тестировалось.
Исходники не вызывают очистку данных, но это не заменяет проверку устройства.

### Безопасная последовательность

1. **Не удалять Notebook и не очищать его данные.** Не использовать adb uninstall, pm clear
   или обход проверки подписи. Дождаться подтверждения всех pending saves в старом приложении.
2. В Android Настройки → Приложения → Notebook проверить версию. При доступном ADB:
   `adb shell dumpsys package ru.metroom.notebook` (смотреть versionName/versionCode).
3. Получить путь: `adb shell pm path ru.metroom.notebook`, скопировать показанный base.apk
   командой `adb pull <путь-base.apk> installed-base.apk`. Никакие app data не извлекаются.
4. Сравнить `apksigner verify --print-certs installed-base.apk` и ту же команду для нового APK.
   Требуется совпадение SHA-256 сертификата и отсутствие downgrade versionCode.
5. **Только при совместимой подписи** открыть новый APK на телефоне и выбрать штатное
   «Обновить», либо выполнить `adb install -r <новый.apk>`. После обновления проверить
   прежний сервер, вход, настройки и открытые документы. Сверить SHA через «О сборке».
6. Если подписи различаются / INSTALL_FAILED_UPDATE_INCOMPATIBLE — остановиться, оставить
   старое приложение установленным и пересобрать с исходным ключом. Удаление приложения
   не предлагается как обход: оно нарушило бы требование сохранения локальных данных.

Существующий GitHub debug job создаёт тестовые APK, а не гарантированно совместимые updates:
у разных runner могут быть разные debug keys. Workflow не изменён. Стабильный release signing
настраивается отдельно с исходным ключом; новый release/tag здесь не создаётся.

## Сборка и проверка

Среда: Node 24, JDK 21, Gradle 8.14.3, Android SDK 36, Build Tools 35.0.0.

```powershell
cd C:\Project\Note\android-client
npm.cmd ci
npm.cmd run check
npm.cmd audit
npm.cmd run sync
cd android
.\gradlew.bat --no-daemon --console=plain lintDebug testDebugUnitTest assembleDebug
```

Готовый debug APK: `android-client/android/app/build/outputs/apk/debug/app-debug.apk`.
Финальный файл дополнительно копируется там же как `Notebook-0.6.0-g<SHA8>-debug.apk`;
рядом JSON с full commit, SHA-256 APK и сертификатом. APK из dirty tree является промежуточным:
для передачи после commit выполняется повторная сборка с clean source identity.

Android check/server URL/build identity checks, lintDebug, testDebugUnitTest и assembleDebug
проходят. Native app tests: 2 passed, включая проверку BuildConfig SHA/package/version.
App lint: 0 errors, 28 warnings (ресурсы/manifest/tooling); upstream Capacitor имеет свой
поставляемый baseline, он не добавлялся и не расширялся. Web lint/typecheck/tests/build
проходят: 295 passed / 36 existing skips. Chrome с подставленным native bridge проверил
реальный bootstrap → remote redirect, version/SHA query, новый блок настроек и fallback
старого APK. Это не проверка настоящего Android bridge или сохранения данных на Fold.

Первая локальная попытка Gradle unit tests упала из-за некорректной кавычки в унаследованном
Windows PATH. PATH исправлен только в окружении процесса сборки; системные настройки
и Windows Runner не менялись. После повторения все доступные проверки прошли.

## Статус приёмки

APK — проверяемый debug artifact. Совместимое обновление установленной копии требует
сопоставления подписи/исходного ключа. Реальный Fold не подключён; ни установка поверх,
ни Studio на удалённом сервере, ни реальная клавиатура на устройстве не объявляются проверенными.
Приёмка пользователем на Galaxy Z Fold 8 остаётся открытой. Production deployment не выполнялся.

Изменённые файлы: `ANDROID.md`, этот отчёт; Android `app/build.gradle`, `AndroidManifest.xml`,
`MainActivity.java`, новый `NotebookAppInfoPlugin.java`, `res/values/build-info.xml`,
`res/xml/shortcuts.xml`, `BuildIdentityTest.java`; `android-client/package.json`/lock,
`scripts/validate-client.mjs`, `scripts/check-app-info.mjs`, `www/app.js`, `www/app-info.js`,
`www/index.html`; web `settings-dialog.tsx`, `android-app-info.tsx`, `native-android.ts`,
`src/lib/android-app-info.ts` и его unit tests.

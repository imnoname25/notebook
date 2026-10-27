# Android: сохранение авторизации при повторном запуске

## Найденная причина

APK сначала открывает встроенный chooser на `https://localhost`, читает `notebook.serverUrl`, проверяет сервер и открывает `<server>/app?client=android`. Ранее последний шаг выполнялся через `window.location.replace`. Это cross-site переход, инициированный JavaScript локальной страницы. Cookie `notebook_session` имеет `SameSite=Strict`, поэтому она не отправляется в таком запросе. Серверный `/app` не видит авторизацию и перенаправляет на `/login`.

Потеря входа в этом сценарии не означает удаления cookie или завершения записи Session в PostgreSQL. Сохранение адреса сервера не связано с авторизацией: адрес находится в localStorage локального origin, а cookie — в cookie store WebView для origin сервера.

До исправления воспроизведено в Chrome на двух изолированных локальных origin с синтетической постоянной HttpOnly/Strict cookie: после перехода из chooser запрос `/app` имел `Sec-Fetch-Site: cross-site` и не имел cookie, хотя cookie оставалась в хранилище. Новый переход без инициатора (`Sec-Fetch-Site: none`) отправлял ту же cookie. Проверено восстановление cookie store в новом browser context, а также её удаление явным logout. Это проверка поведения Chromium, не физического Android.

## Исправление

Локальный chooser вызывает новый native-метод `NotebookSession.openNotebook({url})`. Он выполняет `WebView.loadUrl` на UI thread, без JavaScript initiator. После загрузки серверной страницы очищается история chooser. Существующий Android Back contract остаётся прежним.

Метод разрешён только при текущем origin встроенного chooser (`bridge.getLocalUrl`): сравниваются scheme, host и эффективный port. Удалённая серверная страница не может вызвать этот метод для произвольной native-навигации. Цель обязана быть HTTP(S) URL `/app` (включая существующий префикс пути), без credentials и fragment. Проверка доступности/совместимости сервера и нормализация URL сохраняются. Ошибка native-перехода показывается chooser; скрытого возврата к проблемному JavaScript-переходу нет. Обычный браузерный запуск chooser сохраняет replace-navigation.

Cookie не читается в JavaScript, не копируется в Preferences/localStorage и не превращается в отдельный токен. Сохраняются `HttpOnly`, `SameSite=Strict`, `Secure` для HTTPS, `Expires`, `Max-Age`, server-side idle/absolute expiration и отзыв сессий. Flush при login/logout/pause/stop остаётся. API, PostgreSQL, Docker, Unraid и серверная конфигурация не меняются. Для этого исправления требуется новый APK; обновление только веб-интерфейса не заменяет встроенный chooser/native plugin.

## Проверки

- `cd android-client; npm run check`: URL/build identity/client contract и native-launch helper (успех, browser fallback, отсутствие fallback при native error).
- `npm run check:session-browser`: Google Chrome должен быть установлен; воспроизводит cross-site проблему и проверяет переход без инициатора, persistent Strict/HttpOnly cookie и logout. Используются только локальный HTTP server, динамический порт и синтетические данные.
- `android/gradlew.bat -p android lintDebug testDebugUnitTest assembleDebug`: Gradle lint, Java unit tests и APK. `NotebookLaunchPolicyTest` проверяет разрешённые URL, origin boundary, credentials, invalid URI и запрещённые схемы.
- Корневой `npm run check`: version contract, lint, typecheck, unit tests, production build.

Подключённых устройств по `adb devices -l` нет. Android instrumentation, фактический kill/reboot, установка поверх и проверка на физическом Fold не выполнены. Chrome regression не подтверждает прохождение native bridge на устройстве. Интеграционные PostgreSQL-тесты без выделенной тестовой БД остаются пропущенными.

Локально прошли client checks, Chrome regression, Gradle `lintDebug testDebugUnitTest assembleDebug`: 5 Java tests, 0 failures; app lint — 0 errors, 28 существующих warnings. Signing configuration не изменена; сертификат локального debug APK — SHA-256 `6e6480d2d68ca8307219ab7b37e4f17e8fe954b7a82e1d119a90cd65311b6a5c`, тот же, что зафиксирован в предыдущем отчёте `ANDROID_APK_REFRESH.md`. Это не подтверждает сертификат установленной на недоступном телефоне копии.

Корневой `npm run check` успешен: lint, typecheck, production build; unit tests — 326 passed, 36 skipped (60 файлов passed, 11 skipped). Новые клиентские helper/browser проверки и 3 новых Java-теста перечислены отдельно выше, в эти 326 не входят.

## Сборка и обновление

```powershell
cd C:\Project\Note\android-client
npm ci
npm run check
npm run sync
.\android\gradlew.bat -p android lintDebug testDebugUnitTest assembleDebug
```

APK: `android-client/android/app/build/outputs/apk/debug/app-debug.apk`. Debug versionName содержит `-g<8 символов commit>`; полные Git SHA и признак локальных изменений доступны в «О сборке» по удержанию значка, а также в настройках поддерживающего сервера. Сборка после коммита должна показывать чистые исходники. Релиз и release tag автоматически не создаются.

Скопировать готовый APK на телефон и выбрать установку поверх существующего Notebook. Либо при подключённом устройстве выполнить `adb install -r <путь-к-APK>`. `applicationId` и существующий локальный signing key не изменяются. Совместимое обновление требует того же сертификата, что у установленной копии; подпись на недоступном устройстве не подтверждена. Если Android сообщает «Приложение не обновлено», не удалять приложение и не очищать его данные: сначала сопоставить сертификаты. Не применять `adb uninstall`/`pm clear` как способ обновления.

## Приёмка на физическом Fold

1. Проверить commit в «О сборке» и прежний адрес сервера. Если прежняя сессия уже отозвана/истекла, войти один раз.
2. Свернуть Notebook кнопкой Home и открыть снова: вход сохраняется.
3. Удалить Notebook из списка недавних приложений, открыть снова: вход сохраняется.
4. Выполнить «Остановить» в настройках Android и снова открыть Notebook: вход сохраняется.
5. Перезагрузить телефон и открыть Notebook: вход сохраняется.
6. Выполнить явный «Выйти», закрыть и открыть приложение: вход не восстанавливается. Проверить обычный повторный вход.
7. Повторить запуск после обновления APK с совместимой подписью без удаления данных.

При повторении проблемы сообщить build commit, способ закрытия и произошло ли возвращение к login сразу или после периода неактивности. Не присылать cookies, пароли, session token или необработанный сетевой журнал. Production deployment в рамках задачи не выполняется.

## Изменённые файлы

- Native: `NotebookSessionPlugin.java`, новый `NotebookLaunchPolicy.java` и `NotebookLaunchPolicyTest.java` в `android-client/android/app/src/`.
- Chooser: `android-client/www/app.js`, новый `open-notebook.js`.
- Проверки: `android-client/package.json`, `scripts/validate-client.mjs`, новые `check-session-navigation.mjs` и `check-session-cookies.mjs`; существующий `src/lib/mobile-shell-contract.test.ts` согласован с новым переходом.
- Документация: `ANDROID.md` и этот отчёт.

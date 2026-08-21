# Notebook для Android

Android-клиент находится в `android-client/` и построен на Capacitor 8. Его стабильный package ID — `ru.metroom.notebook`; текущий `versionName` берётся из корневого `package.json`, а положительный целочисленный `versionCode` хранится отдельно в Gradle. Основной интерфейс загружается с выбранного self-hosted сервера, а native project оставляет место для будущих AutofillService, BiometricPrompt, secure storage, share intent и системных file picker.

## Установка APK

Стабильный universal APK публикуется как `Notebook-<version>.apk` в GitHub Releases. Скачайте его на Android, разрешите установку из выбранного источника и подтвердите установку. Приложение не выполняет silent install; найденное обновление только открывает штатную загрузку APK.

При первом запуске укажите адрес Notebook, например `https://notes.example.com`. Клиент принимает только HTTP/HTTPS URL без credentials, query или fragment, проверяет `/api/health/live` и ожидает совместимый ответ Notebook с версией API. `http://192.168.x.x:port` разрешён для LAN/debug, но экран явно предупреждает об отсутствии шифрования. Для реального использования настройте HTTPS.

Пароль не сохраняется в SharedPreferences. Авторизация использует существующую server session в WebView. Локально сохраняется только адрес сервера. После успешной проверки клиент открывает сервер через replace-navigation: локальный экран подключения не остаётся в истории WebView. При следующем запуске сохранённый сервер проверяется и открывается автоматически.

Системный Back и swipe-back используют версионированный контракт `HANDLED` / `UNHANDLED`: редактор → список страниц → блокноты, а на корневом экране событие передаётся Android. Открытый dialog, search или sheet закрывается первым. Native shell ждёт явный результат JavaScript и не вызывает `WebView.goBack()`, поэтому Back не может случайно вернуть экран выбора сервера или внешний URL. В debug-сборке результат можно проверить командой `adb logcat -s NotebookBack`.

WebView хранит только защищённую `HttpOnly` session cookie сервера. После успешного входа и после logout Capacitor bridge вызывает `CookieManager.flush()`; Activity также выполняет flush при pause/stop. Cookie имеет `Expires` и `Max-Age`, ограниченные абсолютным сроком server session. Пароль, raw token и копия cookie не сохраняются в SharedPreferences или web storage.

Явная смена endpoint доступна в мобильном меню через `Подключение · Сменить сервер` и требует подтверждения; серверные данные при этом не удаляются. Gallery/camera/file picker и download проходят через штатные возможности Capacitor WebView и требуют проверки на реальном устройстве.

## Локальная сборка

Нужны Node.js 24, JDK 21 и Android SDK 36:

```bash
cd android-client
npm ci
npm run check
npx cap sync android
./android/gradlew --no-daemon -p android lint test assembleDebug
```

Debug APK: `android-client/android/app/build/outputs/apk/debug/app-debug.apk`.

## Release signing

GitHub Actions использует secrets:

- `ANDROID_KEYSTORE_BASE64`;
- `ANDROID_KEYSTORE_PASSWORD`;
- `ANDROID_KEY_ALIAS`;
- `ANDROID_KEY_PASSWORD`.

Перед релизом выполните `npm run version:set -- 0.4.1`, затем `npm run version:check`. Команда синхронизирует root/Android package metadata и Gradle `versionName`, а `versionCode` увеличивает на единицу. При стабильном tag `v0.4.1` workflow до сборки сверяет tag, обе package versions и Gradle `versionName`, затем временно восстанавливает keystore, собирает подписанные APK/AAB и прикладывает их к GitHub Release. Keystore и пароли не коммитятся.

> Потеря signing key не позволит устанавливать новые версии поверх уже установленного APK с тем же package ID. Храните зашифрованную резервную копию key и паролей отдельно от GitHub.

## Security foundation

`NotebookSecureStorage` предоставляет device-bound AES-256-GCM envelope на Android Keystore. `BiometricCapability` проверяет готовность strong biometric/device credential. Это только foundation: biometric login, сохранение vault key и AutofillService ещё не включены. HTTP cleartext разрешён в manifest исключительно для явно выбранного LAN/debug URL; это осознанное ограничение, поэтому production server должен использовать HTTPS.

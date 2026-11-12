package ru.metroom.notebook;

import android.os.Bundle;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

import org.json.JSONTokener;

public class MainActivity extends BridgeActivity {
    private static final String BACK_TAG = "NotebookBack";
    private static final String HANDLED = "HANDLED";
    private static final String APP_INFO_ACTION = "ru.metroom.notebook.APP_INFO";
    private static final String SHARE_QUEUE_ACTION = "ru.metroom.notebook.SAVED_SHARE_QUEUE";
    private static final String WEB_BACK_HANDLER =
            "(function(){try{var h=window.__NOTEBOOK_ANDROID_BACK__;if(typeof h!=='function')return 'MISSING';var r=h();return r==='HANDLED'?'HANDLED':'UNHANDLED';}catch(error){return 'ERROR';}})()";
    private boolean backRequestPending = false;
    private NotebookShareManager shares;
    private NotebookShareDialogs shareDialogs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Intent incoming = getIntent();
        boolean shared = NotebookShareIntent.accepts(incoming);
        if (shared) setIntent(new Intent(Intent.ACTION_MAIN));
        shares = NotebookShareManager.get(this);
        shareDialogs = new NotebookShareDialogs(this, shares);
        registerPlugin(NotebookSessionPlugin.class);
        registerPlugin(NotebookSharePlugin.class);
        registerPlugin(NotebookAppInfoPlugin.class);
        super.onCreate(savedInstanceState);
        if (shared && savedInstanceState == null) shares.receive(new Intent(incoming));
        handleAppInfoIntent(getIntent());

        CookieManager.getInstance().setAcceptCookie(true);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (backRequestPending) {
                    debugLog("request already pending");
                    return;
                }
                if (bridge == null || bridge.getWebView() == null) {
                    debugLog("WebView unavailable; result=UNHANDLED");
                    dispatchSystemBack(this);
                    return;
                }

                backRequestPending = true;
                bridge.getWebView().evaluateJavascript(WEB_BACK_HANDLER, rawResult -> {
                    backRequestPending = false;
                    String result = decodeJavascriptResult(rawResult);
                    if (!"MISSING".equals(result) && !"ERROR".equals(result)) debugLog("JS handler found");
                    debugLog("result=" + result);
                    if (!HANDLED.equals(result)) dispatchSystemBack(this);
                });
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (NotebookShareIntent.accepts(intent)) {
            // Capacitor sees only the sanitized launcher Intent.
            Intent launcher = new Intent(Intent.ACTION_MAIN);
            super.onNewIntent(launcher);
            setIntent(launcher);
            shares.receive(new Intent(intent));
            return;
        }
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && SHARE_QUEUE_ACTION.equals(intent.getAction())) {
            setIntent(new Intent(Intent.ACTION_MAIN));
            getWindow().getDecorView().post(this::showShareQueue);
        }
        handleAppInfoIntent(intent);
    }

    private void handleAppInfoIntent(Intent intent) {
        if (intent == null || !APP_INFO_ACTION.equals(intent.getAction())) return;
        intent.setAction(Intent.ACTION_MAIN);
        getWindow().getDecorView().post(() -> new AlertDialog.Builder(this)
                .setTitle("О сборке Notebook")
                .setMessage("Android: " + BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")"
                        + "\nGit: " + BuildConfig.SOURCE_COMMIT
                        + "\nИсходники: " + (BuildConfig.SOURCE_DIRTY ? "есть локальные изменения" : "чистый commit")
                        + "\nТип: " + (BuildConfig.DEBUG ? "debug" : "release")
                        + "\n\nИнтерфейс заметок загружается с выбранного сервера. Версия APK не подтверждает версию веб-интерфейса.")
                .setPositiveButton(android.R.string.ok, null).show());
    }

    void showShareQueue() { shareDialogs.showQueue(); }

    @Override
    public void onResume() {
        super.onResume();
        shares.resume(shareDialogs);
    }

    @Override
    public void onPause() {
        shares.pause(shareDialogs);
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    public void onStop() {
        CookieManager.getInstance().flush();
        super.onStop();
    }

    @Override
    public void onDestroy() {
        shareDialogs.close();
        super.onDestroy();
    }

    private String decodeJavascriptResult(String rawResult) {
        if (rawResult == null) return "NO_RESULT";
        try {
            Object value = new JSONTokener(rawResult).nextValue();
            return value instanceof String ? (String) value : "INVALID_RESULT";
        } catch (Exception ignored) {
            return "INVALID_RESULT";
        }
    }

    private void dispatchSystemBack(OnBackPressedCallback callback) {
        callback.setEnabled(false);
        try {
            getOnBackPressedDispatcher().onBackPressed();
        } finally {
            callback.setEnabled(true);
        }
    }

    private void debugLog(String message) {
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) Log.d(BACK_TAG, message);
    }
}

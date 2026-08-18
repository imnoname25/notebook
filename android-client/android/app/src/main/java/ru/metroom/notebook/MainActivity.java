package ru.metroom.notebook;

import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

import org.json.JSONTokener;

public class MainActivity extends BridgeActivity {
    private static final String BACK_TAG = "NotebookBack";
    private static final String HANDLED = "HANDLED";
    private static final String WEB_BACK_HANDLER =
            "(function(){try{var h=window.__NOTEBOOK_ANDROID_BACK__;if(typeof h!=='function')return 'MISSING';var r=h();return r==='HANDLED'?'HANDLED':'UNHANDLED';}catch(error){return 'ERROR';}})()";
    private boolean backRequestPending = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NotebookSessionPlugin.class);
        super.onCreate(savedInstanceState);

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
    public void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    public void onStop() {
        CookieManager.getInstance().flush();
        super.onStop();
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

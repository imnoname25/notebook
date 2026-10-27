package ru.metroom.notebook;

import android.webkit.CookieManager;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.WebViewListener;

@CapacitorPlugin(name = "NotebookSession")
public class NotebookSessionPlugin extends Plugin {
    private boolean clearBootstrapHistory;

    @Override
    public void load() {
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView webView) {
                if (clearBootstrapHistory && !NotebookLaunchPolicy.sameOrigin(webView.getUrl(), getBridge().getLocalUrl())) {
                    webView.clearHistory();
                    clearBootstrapHistory = false;
                }
            }
        });
    }

    @PluginMethod
    public void openNotebook(PluginCall call) {
        String target = call.getString("url");
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            if (!NotebookLaunchPolicy.allows(webView.getUrl(), getBridge().getLocalUrl(), target)) {
                call.reject("Notebook launch is allowed only from the bundled server chooser to an HTTP(S) app URL");
                return;
            }
            clearBootstrapHistory = true;
            call.resolve();
            // No JavaScript initiator: retain Strict cookies without reading/copying tokens.
            webView.loadUrl(target);
        });
    }

    @PluginMethod
    public void flushCookies(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            CookieManager.getInstance().flush();
            JSObject result = new JSObject();
            result.put("flushed", true);
            call.resolve(result);
        });
    }
}

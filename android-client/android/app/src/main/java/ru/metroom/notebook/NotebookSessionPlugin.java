package ru.metroom.notebook;

import android.webkit.CookieManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NotebookSession")
public class NotebookSessionPlugin extends Plugin {
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

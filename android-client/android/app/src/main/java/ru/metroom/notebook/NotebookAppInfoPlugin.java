package ru.metroom.notebook;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Public build identity only; never reads URLs, cookies, storage or documents. */
@CapacitorPlugin(name = "NotebookAppInfo")
public class NotebookAppInfoPlugin extends Plugin {
    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("versionName", BuildConfig.VERSION_NAME);
        result.put("versionCode", BuildConfig.VERSION_CODE);
        result.put("gitCommit", BuildConfig.SOURCE_COMMIT);
        result.put("sourceDirty", BuildConfig.SOURCE_DIRTY);
        result.put("debug", BuildConfig.DEBUG);
        call.resolve(result);
    }
}

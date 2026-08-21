package ru.metroom.notebook;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NotebookShare")
public class NotebookSharePlugin extends Plugin {
    private static String pendingText;
    private static String pendingTitle;

    public static synchronized void setPending(String text, String title) {
        pendingText = text;
        pendingTitle = title;
    }

    @PluginMethod
    public void consume(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (NotebookSharePlugin.class) {
            if (pendingText != null) result.put("text", pendingText);
            if (pendingTitle != null) result.put("title", pendingTitle);
            pendingText = null;
            pendingTitle = null;
        }
        call.resolve(result);
    }
}

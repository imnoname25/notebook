package ru.metroom.notebook;

import androidx.webkit.WebViewFeature;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The bridge can open a native dialog. No queue data or file handle crosses it. */
@CapacitorPlugin(name = "NotebookShare")
public class NotebookSharePlugin extends Plugin {
    @PluginMethod
    public void showQueue(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            var bridge = getBridge();
            var manager = NotebookShareManager.get(getContext());
            if (!(getActivity() instanceof MainActivity)
                    || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                    || bridge.getConfig().isUsingLegacyBridge()
                    || !manager.allowsQueue(bridge.getWebView().getUrl(), bridge.getLocalUrl())) {
                call.reject("Откройте очередь через ярлык приложения.");
                return;
            }
            ((MainActivity) getActivity()).showShareQueue();
            call.resolve();
        });
    }
}

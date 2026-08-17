import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ru.metroom.notebook",
  appName: "Notebook",
  webDir: "www",
  server: {
    androidScheme: "https",
    allowNavigation: ["*"],
  },
  plugins: {
    CapacitorHttp: { enabled: true },
    StatusBar: {
      overlaysWebView: false,
      style: "DEFAULT",
      backgroundColor: "#fafafa",
    },
    SystemBars: {
      insetsHandling: "css",
      style: "DEFAULT",
      hidden: false,
    },
  },
};

export default config;

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
  },
};

export default config;

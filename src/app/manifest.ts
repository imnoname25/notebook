import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { id: "/app", name: "Notebook — цифровая записная книжка", short_name: "Notebook", description: "Простая self-hosted цифровая записная книжка", start_url: "/app", scope: "/", display: "standalone", background_color: "#fafafa", theme_color: "#334a70", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] };
}

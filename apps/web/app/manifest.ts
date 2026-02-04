import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Multica",
    short_name: "Multica",
    description: "Distributed AI agent framework",
    id: "/",
    scope: "/",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      {
        src: "/logo-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/logo-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/logo-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

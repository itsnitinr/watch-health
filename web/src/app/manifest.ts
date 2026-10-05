import type { MetadataRoute } from "next";

/** Lets Chrome on the phone install the dashboard as a standalone app ("Add to Home screen"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Watch Health",
    short_name: "Watch Health",
    description: "Personal Galaxy Watch health dashboard",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f0f11",
    theme_color: "#18181b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Sleep", url: "/sleep" },
      { name: "Workouts", url: "/workouts" },
      { name: "Ask", url: "/chat" },
    ],
  };
}

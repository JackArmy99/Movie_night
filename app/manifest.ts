import type { MetadataRoute } from "next";

// Lets "Add to Home Screen" install it like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Movie Night",
    short_name: "Movie Night",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1115",
    theme_color: "#0f1115",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}

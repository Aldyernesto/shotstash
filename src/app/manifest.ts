// PWA manifest. Name, description, icon and colors come from src/lib/brand.ts.
import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.productName,
    short_name: brand.productName,
    description: brand.description,
    start_url: "/",
    display: "standalone",
    background_color: brand.themeColor,
    theme_color: brand.themeColor,
    icons: [{ src: brand.icon, sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}

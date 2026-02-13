import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@multica/ui", "@multica/store", "@multica/hooks", "@multica/sdk"],
  rewrites: async () => [
    {
      source: "/api/:path*",
      destination: `${process.env.API_URL || "https://api-dev.copilothub.ai"}/api/:path*`,
    },
  ],
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        {
          key: "Cache-Control",
          value: "no-cache, no-store, must-revalidate",
        },
        {
          key: "Content-Type",
          value: "application/javascript; charset=utf-8",
        },
      ],
    },
  ],
};

export default nextConfig;

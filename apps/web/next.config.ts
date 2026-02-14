import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@multica/ui", "@multica/store", "@multica/hooks", "@multica/sdk"],
  rewrites: async () => {
    const apiUrl = process.env.MULTICA_API_URL;
    if (!apiUrl) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
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

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript sources consumed directly, so Next has to
  // compile them rather than assume a prebuilt CommonJS bundle.
  transpilePackages: ["@limenlabs/sdk", "@limenlabs/protocol-config"],
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), payment=()",
        },
      ],
    },
  ],
};

export default nextConfig;

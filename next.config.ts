import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        // HSTS is emitted by the Vercel edge; adding a second header here would
        // produce a duplicate with a weaker policy.
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            // Team logos and news thumbnails come from many provider CDNs.
            "img-src 'self' data: https:",
            // Next.js App Router emits inline bootstrap scripts/styles.
            // React dev-mode debugging requires eval; production never uses it.
            `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "connect-src 'self'",
            "worker-src 'self'",
            "manifest-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; "),
        },
      ],
    }];
  },
};

export default nextConfig;

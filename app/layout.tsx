import type { Metadata } from "next";
import type { ReactNode } from "react";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Cadence — Day 1 proof",
  description: "Riskiest-path proof: Google login -> Gemini -> Calendar event.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          color: "#2E2E2B",
          background: "#FAF9F6",
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

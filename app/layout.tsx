import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { appearanceAttributes } from "@/lib/appearance";
import { currentAppearance } from "@/lib/appearance-server";
import { AppearanceSync } from "@/components/AppearanceSync";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AGENTME",
  description: "Your AI agent handles the conversation. You make the decisions.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AGENTME", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#2f6b4f",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Each person/identity pair uses its own colours, including the first paint.
  const appearance = await currentAppearance();
  const look = appearanceAttributes(appearance);
  return (
    <html lang="en" {...look} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans"><AppearanceSync look={appearance} />{children}</body>
    </html>
  );
}

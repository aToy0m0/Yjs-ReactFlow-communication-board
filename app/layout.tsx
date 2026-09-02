import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "@xyflow/react/dist/style.css";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

const notoSansJp = localFont({
  src: "../public/fonts/noto-sans-jp/NotoSansJP-Variable.ttf",
  weight: "100 900",
  variable: "--font-noto-sans-jp",
  display: "swap",
});

export const metadata: Metadata = {
  title: "れんらくがかり — 共同編集ボード",
  description: "YjsとReact Flowで作るリアルタイム共同編集ボード",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" className={notoSansJp.variable}>
      <body><TooltipProvider>{children}</TooltipProvider></body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "고정비 배부율 조사",
  description: "조직별 고정비 배부율 조사/취합 웹",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

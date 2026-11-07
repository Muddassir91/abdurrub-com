import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { FinanceProvider } from "@/store/FinanceProvider";
import { ToastProvider } from "@/components/ui/toast";
import { Gate } from "@/components/Gate";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Finance OS · Retention Rules",
  description: "Personal CFO and agency financial operating system.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d12" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script
          // Apply the saved theme before paint to avoid a flash.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('finance-os:theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full">
        <ToastProvider>
          <FinanceProvider>
            <Gate>{children}</Gate>
          </FinanceProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

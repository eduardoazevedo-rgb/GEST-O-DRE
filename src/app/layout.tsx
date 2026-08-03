import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import { AuthProvider } from "@/context/AuthContext";
import { EmpresaProvider } from "@/context/EmpresaContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ToastProvider } from "@/context/ToastContext";
import "./globals.css";

const figtree = Figtree({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Portal Hoff Controladoria",
  description: "Controladoria · Planejado × Realizado",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Portal Hoff" },
};

export const viewport: Viewport = {
  themeColor: "#0000C2",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={figtree.variable}>
      <body className="h-full antialiased">
        <ThemeProvider>
          <AuthProvider>
            <EmpresaProvider>
              <ToastProvider>{children}</ToastProvider>
            </EmpresaProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

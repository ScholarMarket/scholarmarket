import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/providers/WalletProvider";
import { ToastProvider } from "@/providers/ToastProvider";
import { CartProvider } from "@/providers/CartProvider";
import { ComparisonProvider } from "@/providers/ComparisonProvider";
import { TransactionProvider } from "@/providers/TransactionProvider";
import ReducedMotionProvider from "@/components/ReducedMotionProvider";
import CartDrawer from "@/components/CartDrawer";
import ComparisonMatrix from "@/components/ComparisonMatrix";
import CompareTray from "@/components/CompareTray";
import RouteFocusManager from "@/components/RouteFocusManager";
import SessionExpiredModal from "@/components/SessionExpiredModal";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "ScholarMarket - Decentralized Educational Materials Sharing",
  description: "Share and monetize your educational materials on the blockchain with ScholarMarket",
  icons: {
    icon: "/logo.png",              // general favicon
    shortcut: "/logo.png",          // legacy shortcut icon
    apple: "/logo.png"     // optional iOS icon (place in public/ if used)
  },
};

const themeInitScript = `
(() => {
  try {
    const storageKey = "scholarmarket-theme";
    const storedTheme = window.localStorage.getItem(storageKey);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : (prefersDark ? "dark" : "light");

    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (error) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow-lg"
        >
          Skip to main content
        </a>
        <RouteFocusManager />
        <ReducedMotionProvider>
          <WalletProvider>
            <ToastProvider>
              <SessionExpiredModal />
              <CartProvider>
                <ComparisonProvider>
                  <TransactionProvider>
                    {children}
                    <CartDrawer />
                    <CompareTray />
                    <ComparisonMatrix />
                  </TransactionProvider>
                </ComparisonProvider>
              </CartProvider>
            </ToastProvider>
          </WalletProvider>
        </ReducedMotionProvider>
      </body>
    </html>
  );
}

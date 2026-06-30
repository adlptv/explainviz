import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "ExplainViz — Database Query Plan Visualizer",
  description:
    "Understand, visualize, and optimize your SQL queries. Paste EXPLAIN output and get interactive flame graphs, tree visualizations, index suggestions, and plan diffs.",
  keywords: ["SQL", "EXPLAIN", "query plan", "PostgreSQL", "MySQL", "SQLite", "optimization", "database"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <div className="relative flex min-h-screen flex-col">
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "MESH — Find people worth knowing",
  description:
    "AI gets to know you, finds someone worth meeting, and helps create the first connection.",
};

const nav = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/safety", label: "Safety" },
  { href: "/privacy", label: "Privacy" },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
            <Link href="/" className="editorial text-lg tracking-[0.2em]">
              MESH
            </Link>
            <nav className="flex items-center gap-6 text-sm text-muted">
              {nav.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-foreground">
                  {item.label}
                </Link>
              ))}
              <Link
                href="/meet"
                className="rounded-full bg-accent px-4 py-2 text-white hover:opacity-90"
              >
                Meet Your Agent
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-16">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted">
            <span>© {new Date().getFullYear()} MESH</span>
            <div className="flex gap-6">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/safety">Safety</Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

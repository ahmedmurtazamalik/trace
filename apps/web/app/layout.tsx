import type { Metadata } from "next";
import { AuthSessionProvider } from "@/auth/session-provider";
import "./globals.css";
export const metadata: Metadata = { title: { default: "Trace", template: "%s · Trace" }, description: "Development activity, clearly traced." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><AuthSessionProvider>{children}</AuthSessionProvider></body></html>; }

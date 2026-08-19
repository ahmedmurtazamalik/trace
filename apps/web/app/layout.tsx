import type { Metadata } from "next";
import { AuthSessionProvider } from "@/auth/session-provider";
import { ReportDraftRecoveryProvider } from "@/components/shell/report-draft-recovery";
import { MockModeProvider } from "@/mocks/mock-mode-provider";
import "./globals.css";
export const metadata: Metadata = { title: { default: "Trace", template: "%s · Trace" }, description: "Development activity, clearly traced." };
const themeBoot = `(function(){try{var t=localStorage.getItem('trace-theme');if(t!=='light'&&t!=='night')t=matchMedia('(prefers-color-scheme: dark)').matches?'night':'light';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})()`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBoot }} /></head><body><MockModeProvider><AuthSessionProvider><ReportDraftRecoveryProvider>{children}</ReportDraftRecoveryProvider></AuthSessionProvider></MockModeProvider></body></html>; }

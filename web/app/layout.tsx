import type { Metadata } from "next";
import "./globals.css";
import OrgHeader from "@/components/OrgHeader";

export const metadata: Metadata = {
  title: "finErpAP — AP Automation",
  description: "Invoice pipeline dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OrgHeader />
        <main className="page">{children}</main>
      </body>
    </html>
  );
}

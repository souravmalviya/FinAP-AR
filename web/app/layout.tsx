import type { Metadata, Viewport } from "next";
import "./globals.css";
import OrgHeader from "@/components/OrgHeader";

export const metadata: Metadata = {
  title: "Verity | AP Automation",
  description: "Every invoice, verified.",
};

// Without this, phones assume a ~980px desktop viewport and shrink the whole
// page to fit, which is why everything looked tiny and broken on mobile.
// width=device-width makes CSS pixels match the device; the media queries in
// globals.css only take effect once this is set.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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

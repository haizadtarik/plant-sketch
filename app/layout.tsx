import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "PlantSKetch",
  description:
    "Create an editable FUXA HMI from a P&ID and correct it directly in FUXA.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

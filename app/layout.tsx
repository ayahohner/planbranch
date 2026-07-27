import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "@xyflow/react/dist/style.css";
import "./globals.css";
import "./task-tree/task-tree.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "A local, observable workspace for decomposing complex work into ordered Tasks.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol =
    forwardedProtocol ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const image = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: "Task Tree",
    description,
    openGraph: {
      title: "Task Tree",
      description,
      type: "website",
      images: [
        {
          url: image,
          width: 1731,
          height: 909,
          alt: "Task Tree ordered decomposition workspace",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Task Tree",
      description,
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

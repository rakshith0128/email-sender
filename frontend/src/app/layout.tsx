import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Outbox — Email Scheduler',
  description: 'Schedule, throttle and track outbound email campaigns.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import './globals.css';

export default function RootLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <header className="banner">
          <a href="/">Grounds Mission Control</a>
          <nav>
            <a href="/">Runs</a>
            <a href="/runs/new">New run</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

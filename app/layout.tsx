import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ESP Canvas",
  description: "Draw & send frames to ESP8266 displays",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <nav style={{
          display:"flex",alignItems:"center",gap:"0.5rem",
          padding:"0.875rem 1.5rem",borderBottom:"1px solid var(--border)",
          background:"var(--bg2)",position:"sticky",top:0,zIndex:50
        }}>
          <a href="/" style={{fontWeight:800,fontSize:"1.1rem",letterSpacing:"-0.02em",textDecoration:"none",color:"var(--text)"}}>
            ◈ ESP<span style={{color:"var(--accent)"}}>Canvas</span>
          </a>
          <div style={{marginLeft:"auto",display:"flex",gap:"0.5rem"}}>
            {[{href:"/onboard",label:"+ Onboard"},{href:"/draw",label:"Dessiner"},{href:"/admin",label:"Admin"}].map(l=>(
              <a key={l.href} href={l.href} style={{
                padding:"0.3rem 0.8rem",borderRadius:"6px",fontSize:"0.85rem",
                color:"var(--text2)",textDecoration:"none",border:"1px solid var(--border)",
                background:"var(--bg3)"
              }}>{l.label}</a>
            ))}
          </div>
        </nav>
        <main style={{minHeight:"calc(100vh - 57px)"}}>
          {children}
        </main>
      </body>
    </html>
  );
}

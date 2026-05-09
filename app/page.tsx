export default function Home() {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"80vh",padding:"2rem",textAlign:"center"}}>
      <div style={{fontSize:"4rem",marginBottom:"1rem",background:"linear-gradient(135deg,var(--accent),var(--accent2))",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>◈</div>
      <h1 style={{fontSize:"2.5rem",fontWeight:800,marginBottom:"0.5rem",letterSpacing:"-0.03em"}}>
        ESP<span style={{color:"var(--accent)"}}>Canvas</span>
      </h1>
      <p style={{color:"var(--text2)",marginBottom:"2.5rem",maxWidth:420,lineHeight:1.6}}>
        Dessinez sur votre ordinateur, affichez sur vos écrans ESP8266 — e-ink, OLED, en temps réel.
      </p>
      <div style={{display:"flex",gap:"1rem",flexWrap:"wrap",justifyContent:"center"}}>
        <a href="/onboard" style={{padding:"0.75rem 1.5rem",borderRadius:"8px",fontWeight:600,background:"var(--accent)",color:"#fff",textDecoration:"none"}}>+ Ajouter un device</a>
        <a href="/draw" style={{padding:"0.75rem 1.5rem",borderRadius:"8px",fontWeight:600,border:"1px solid var(--border)",color:"var(--text)",textDecoration:"none",background:"var(--bg3)"}}>Dessiner →</a>
        <a href="/admin" style={{padding:"0.75rem 1.5rem",borderRadius:"8px",fontWeight:600,border:"1px solid var(--border)",color:"var(--text2)",textDecoration:"none",background:"var(--bg2)"}}>Admin</a>
        <a href="/my-devices" style={{padding:"0.75rem 1.5rem",borderRadius:"8px",fontWeight:600,border:"1px solid var(--border)",color:"var(--text2)",textDecoration:"none",background:"var(--bg2)"}}>Mes esp</a>

      </div>
      <div style={{marginTop:"4rem",display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"1rem",maxWidth:700}}>
        {[{icon:"🖼",label:'E-Ink 2.9" BWR',desc:"296×128 · N/B/Rouge"},{icon:"⬛",label:'OLED 0.96"',desc:"128×64 · N/B"},{icon:"🌫",label:'E-Ink 2.7" BW',desc:"264×176 · Niveaux de gris"}].map(c=>(
          <div key={c.label} style={{padding:"1.25rem",borderRadius:"10px",border:"1px solid var(--border)",background:"var(--bg2)",textAlign:"left"}}>
            <div style={{fontSize:"1.5rem",marginBottom:"0.5rem"}}>{c.icon}</div>
            <div style={{fontWeight:600,fontSize:"0.85rem"}}>{c.label}</div>
            <div style={{color:"var(--text3)",fontSize:"0.75rem",marginTop:"0.25rem"}}>{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

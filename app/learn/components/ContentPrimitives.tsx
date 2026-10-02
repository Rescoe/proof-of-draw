import type { ReactNode } from "react";
import styles from "../learn.module.css";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className={styles.eyebrow}>{children}</div>;
}

export function SectionHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className={styles.sectionHeading}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2>{title}</h2>
      {children ? <div className={styles.sectionLead}>{children}</div> : null}
    </header>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "success";
  title: string;
  children: ReactNode;
}) {
  return (
    <aside className={`${styles.callout} ${styles[`callout_${tone}`]}`}>
      <strong>{title}</strong>
      <div>{children}</div>
    </aside>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className={styles.inlineCode}>{children}</code>;
}

export function CodeBlock({ children }: { children: ReactNode }) {
  return <pre className={styles.codeBlock}>{children}</pre>;
}

export function MenuPath({ steps }: { steps: string[] }) {
  return (
    <span className={styles.menuPath}>
      {steps.map((step, index) => (
        <span key={step}>
          <kbd>{step}</kbd>
          {index < steps.length - 1 ? <span aria-hidden>›</span> : null}
        </span>
      ))}
    </span>
  );
}

export function Disclosure({
  title,
  children,
  open = false,
  id,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  id?: string;
}) {
  return (
    <details className={styles.disclosure} open={open} id={id}>
      <summary>{title}</summary>
      <div className={styles.disclosureBody}>{children}</div>
    </details>
  );
}

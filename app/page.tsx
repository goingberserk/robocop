import { streams } from "@/lib/streams";
import Logo from "./Logo";
import Workspace from "./Workspace";
import styles from "./page.module.css";

export default function Home() {
  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <h1 className={styles.brand}>
            <Logo />
          </h1>
          <p className={styles.tagline}>Help shows up sooner.</p>
          <span className={styles.status}>
            <span className={styles.statusDot} aria-hidden />
            Runs in your browser
          </span>
        </div>
      </header>
      <main className={styles.main}>
        <Workspace streams={streams} />
      </main>
      <footer className={styles.footer}>
        <span>Detection runs locally. No video leaves this device.</span>
      </footer>
    </>
  );
}

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
            {/* A full reload so the setup starts over from the first step;
                a <Link> would keep the setup where it was. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className={styles.home}
              aria-label="robocop.ai, start over"
            >
              <Logo />
            </a>
          </h1>
          <p className={styles.tagline}>Help shows up sooner.</p>
          <span className={styles.status}>
            <span className={styles.statusDot} aria-hidden />
            On-device detection
          </span>
        </div>
      </header>
      <main className={styles.main}>
        <Workspace streams={streams.filter((s) => !s.hidden)} />
      </main>
      <footer className={styles.footer}>
        <span>
          Detection runs in your browser. Only alert photos leave this device,
          sent through Photon to your phone.
        </span>
      </footer>
    </>
  );
}

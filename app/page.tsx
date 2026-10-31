import { streams } from "@/lib/streams";
import Workspace from "./Workspace";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.brand}>robocop</h1>
      </header>
      <Workspace streams={streams} />
      <footer className={styles.footer}>
        Detection runs in your browser.
      </footer>
    </main>
  );
}

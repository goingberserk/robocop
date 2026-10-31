import { streams } from "@/lib/streams";
import Detector from "./Detector";
import styles from "./page.module.css";

export default function Home() {
  const stream = streams[0];

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.brand}>robocop</h1>
        <div className={styles.meta}>
          <span>
            {stream.title} · {stream.location}
          </span>
          <span className={styles.badge}>5 min recording</span>
        </div>
      </header>
      <Detector src={stream.clipUrl} />
      <footer className={styles.footer}>
        Detection runs in your browser.{" "}
        <a href={`https://www.youtube.com/watch?v=${stream.youtubeId}`}>
          Watch the live stream on YouTube
        </a>
      </footer>
    </main>
  );
}

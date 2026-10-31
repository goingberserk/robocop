import { streams } from "@/lib/streams";
import styles from "./page.module.css";

export default function Home() {
  const stream = streams[0];
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    playsinline: "1",
    rel: "0",
  });

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.brand}>robocop</h1>
        <div className={styles.meta}>
          <span className={styles.live}>Live</span>
          <span>
            {stream.title} · {stream.location}
          </span>
        </div>
      </header>
      <div className={styles.player}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${stream.youtubeId}?${params}`}
          title={`${stream.title}, ${stream.location}`}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <footer className={styles.footer}>
        Source:{" "}
        <a href={`https://www.youtube.com/watch?v=${stream.youtubeId}`}>
          YouTube
        </a>
      </footer>
    </main>
  );
}

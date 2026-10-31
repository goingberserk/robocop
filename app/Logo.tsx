import styles from "./Logo.module.css";

const FRAME =
  "M16 44 V30 Q16 16 30 16 H44 M76 16 H90 Q104 16 104 30 V44 M16 76 V90 Q16 104 30 104 H44 M76 104 H90 Q104 104 104 90 V76";

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className={styles.mark}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      aria-hidden
    >
      <path
        d={FRAME}
        fill="none"
        stroke="currentColor"
        strokeWidth={9}
        strokeLinecap="round"
      />
      <circle className={styles.dot} cx={60} cy={60} r={24} />
      <polyline
        className={styles.check}
        points="49,61 57,69 72,52"
        fill="none"
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Logo() {
  return (
    <span className={styles.logo}>
      <LogoMark size={34} />
      <span className={styles.word}>
        robocop<span className={styles.tld}>.ai</span>
      </span>
    </span>
  );
}

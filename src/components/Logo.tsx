// Product logo: the blue three-bar mark plus the wordmark. Assets and alt text
// come from src/lib/brand.ts.
// - Dark theme: the lockup with the white wordmark.
// - Light theme: the lockup with the ink wordmark. Both files are rendered and
//   CSS shows the one for the active theme (Logo.module.css); the hidden one is
//   display:none, so assistive tech reads the name once.
// Not clickable (a plain image, not a link): identity, not navigation.
import { brand } from '@/lib/brand';
import styles from './Logo.module.css';

const SIZE_CLASS = { app: styles.app, login: styles.login, mobile: styles.mobile, appMobile: styles.appMobile } as const;

export default function Logo({ size = 'app' }: { size?: keyof typeof SIZE_CLASS }) {
  const width = Math.round(brand.logo.width);
  const height = Math.round(brand.logo.height);
  return (
    <span className={`${styles.logo} ${SIZE_CLASS[size]}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimization needed */}
      <img className={styles.onDark} src={brand.logo.onDark} alt={brand.productName} width={width} height={height} draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimization needed */}
      <img className={styles.onLight} src={brand.logo.onLight} alt={brand.productName} width={width} height={height} draggable={false} />
    </span>
  );
}

// Product wordmark. The asset and alt text come from src/lib/brand.ts.
// - Dark theme: the wordmark sits directly on the page.
// - Light theme: the same on-dark wordmark sits on a dark "slate" panel
//   (see Logo.module.css), because the yellow accent is unreadable on the
//   light page background.
// Not clickable (a plain image, not a link): identity, not navigation.
import { brand } from '@/lib/brand';
import styles from './Logo.module.css';

export default function Logo({ size = 'app' }: { size?: 'app' | 'login' | 'mobile' }) {
  return (
    <span className={`${styles.logo} ${size === 'login' ? styles.login : size === 'mobile' ? styles.mobile : styles.app}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimization needed */}
      <img
        src={brand.logo.onDark}
        alt={brand.productName}
        width={Math.round(brand.logo.width)}
        height={Math.round(brand.logo.height)}
        draggable={false}
      />
    </span>
  );
}

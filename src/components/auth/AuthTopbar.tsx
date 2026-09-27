import Logo from '../Logo';
import ThemeToggle from '../ThemeToggle';
import styles from './auth.module.css';

// Story 1.20: bar identitas halaman auth — wordmark logo 50px (kiri,
// tidak bisa diklik) + theme-toggle (kanan). Posisinya (di alur pada
// varian split, melayang pada centered) diatur AuthPage/auth.module.css.
export default function AuthTopbar() {
  return (
    <div className={styles.topbar}>
      <Logo size="login" />
      <ThemeToggle />
    </div>
  );
}

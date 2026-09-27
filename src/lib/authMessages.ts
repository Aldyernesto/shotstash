// Teks auth yang dipakai bersama server & client. JANGAN import modul server di sini.

/**
 * Frasa penanda akun Google-only. Pesan error AuthService.loginUser dibangun dari frasa ini,
 * dan halaman login memakainya untuk menyorot tombol "Login dengan Google".
 */
export const GOOGLE_ONLY_MARKER = 'terdaftar via Google';

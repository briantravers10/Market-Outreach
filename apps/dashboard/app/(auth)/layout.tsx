/** Bare, centered layout for sign-in flows — no nav, nothing to click but the form. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-shell">{children}</div>;
}

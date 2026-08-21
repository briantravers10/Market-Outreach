import Link from "next/link";
import { loginAction } from "../../../lib/authActions";
import { getAuthConfig } from "../../../lib/authConfig";
import { Wordmark } from "../../../components/Wordmark";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; reset?: string }>;
}) {
  const { error, next, reset } = await searchParams;
  const config = getAuthConfig();

  return (
    <div className="auth-card">
      <Wordmark />
      <h1 className="auth-title">Sign in</h1>
      <p className="auth-sub">Internal prospecting system.</p>

      {reset && <p className="auth-notice auth-notice-ok">Password updated. Sign in with your new password.</p>}
      {error && <p className="auth-notice auth-notice-error">{error}</p>}
      {!config.enabled && (
        <p className="auth-notice auth-notice-error">
          No authentication is configured on this deployment. Set <code>SESSION_SECRET</code> to enable sign-in.
        </p>
      )}

      <form action={loginAction} className="auth-form">
        <input type="hidden" name="next" value={next ?? "/overview"} />
        <label className="auth-label" htmlFor="email">Email</label>
        <input
          className="auth-input"
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
        />

        <label className="auth-label" htmlFor="password">Password</label>
        <input
          className="auth-input"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        <button className="btn btn-primary auth-submit" type="submit">Sign in</button>
      </form>

      <p className="auth-foot">
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
    </div>
  );
}

import Link from "next/link";
import { resetPasswordAction } from "../../../lib/authActions";
import { Wordmark } from "../../../components/Wordmark";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  if (!token) {
    return (
      <div className="auth-card">
        <Wordmark />
        <h1 className="auth-title">Reset link missing</h1>
        <p className="auth-sub">This page needs a valid reset link.</p>
        <p className="auth-foot"><Link href="/forgot-password">Request a new one</Link></p>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <Wordmark />
      <h1 className="auth-title">Choose a new password</h1>
      <p className="auth-sub">At least 12 characters. Longer beats complicated.</p>

      {error && <p className="auth-notice auth-notice-error">{error}</p>}

      <form action={resetPasswordAction} className="auth-form">
        <input type="hidden" name="token" value={token} />
        <label className="auth-label" htmlFor="password">New password</label>
        <input className="auth-input" id="password" name="password" type="password" autoComplete="new-password" required autoFocus minLength={12} />

        <label className="auth-label" htmlFor="confirm">Confirm password</label>
        <input className="auth-input" id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={12} />

        <button className="btn btn-primary auth-submit" type="submit">Update password</button>
      </form>

      <p className="auth-foot"><Link href="/login">Back to sign in</Link></p>
    </div>
  );
}

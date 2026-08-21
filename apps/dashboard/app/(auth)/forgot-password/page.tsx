import Link from "next/link";
import { forgotPasswordAction } from "../../../lib/authActions";
import { Wordmark } from "../../../components/Wordmark";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; link?: string }>;
}) {
  const { sent, link } = await searchParams;

  return (
    <div className="auth-card">
      <Wordmark />
      <h1 className="auth-title">Reset your password</h1>
      <p className="auth-sub">We&apos;ll send a link to reset it, if that address has an account.</p>

      {sent ? (
        <>
          <p className="auth-notice auth-notice-ok">
            If that address has an account, a reset link is on its way. The link expires in 30 minutes and can only
            be used once.
          </p>
          {link && (
            <div className="auth-devlink">
              <p>
                <strong>No email provider is connected yet</strong>, so the link is shown here instead of being
                sent. Wire up an email service before anyone but you uses this.
              </p>
              <Link href={link} className="auth-devlink-url">{link}</Link>
            </div>
          )}
        </>
      ) : (
        <form action={forgotPasswordAction} className="auth-form">
          <label className="auth-label" htmlFor="email">Email</label>
          <input className="auth-input" id="email" name="email" type="email" autoComplete="username" required autoFocus />
          <button className="btn btn-primary auth-submit" type="submit">Send reset link</button>
        </form>
      )}

      <p className="auth-foot"><Link href="/login">Back to sign in</Link></p>
    </div>
  );
}

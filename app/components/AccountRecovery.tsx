'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

async function post(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Something went wrong. Please try again.');
  return data;
}

export function ForgotPasswordForm() {
  const [username, setUsername] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true); setError('');
    try {
      await post('/api/account/password-reset', { username });
      setSent(true);
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };

  return <main className="cw-recovery">
    <h1>Reset your password</h1>
    {sent
      ? <><p role="status">If an account with a recovery email exists, a reset link is on its way. Check your inbox and spam folder.</p>
          <p><Link href="/">Back to COWBOY</Link></p></>
      : <form onSubmit={submit}>
          <p>Enter your username. If the account has a recovery email on file, we will send a one-time reset link.</p>
          <label>Username<input name="username" autoComplete="username" required minLength={3} maxLength={30}
            pattern="[A-Za-z0-9_-]+" value={username} disabled={pending} onChange={e => setUsername(e.target.value)}/></label>
          {error && <p role="alert" className="cw-form-error">{error}</p>}
          <button className="cw-primary" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send reset link'}</button>
          <p><Link href="/">Back to sign in</Link></p>
        </form>}
  </main>;
}

function ResetPasswordInner() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setPending(true); setError('');
    try {
      await post('/api/account/password-reset/confirm', { token, password });
      setDone(true);
    } catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  };

  return <main className="cw-recovery">
    <h1>Choose a new password</h1>
    {!token && <p role="alert" className="cw-form-error">This reset link is missing its token. Request a new one from the forgot-password page.</p>}
    {done
      ? <><p role="status">Your password was updated and all existing sessions were signed out. You can now sign in with the new password.</p>
          <p><Link href="/">Back to COWBOY</Link></p></>
      : token && <form onSubmit={submit}>
          <label>New password<input type="password" name="password" autoComplete="new-password" required minLength={10} maxLength={128}
            value={password} disabled={pending} onChange={e => setPassword(e.target.value)}/></label>
          <span className="cw-field-hint">At least 10 characters.</span>
          <label>Confirm password<input type="password" name="confirm" autoComplete="new-password" required minLength={10} maxLength={128}
            value={confirm} disabled={pending} onChange={e => setConfirm(e.target.value)}/></label>
          {error && <p role="alert" className="cw-form-error">{error}</p>}
          <button className="cw-primary" type="submit" disabled={pending}>{pending ? 'Updating…' : 'Update password'}</button>
        </form>}
  </main>;
}

export function ResetPasswordForm() {
  return <ResetPasswordInner/>;
}

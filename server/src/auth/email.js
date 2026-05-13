// Email-sending wrapper around Resend. Templates are inline strings so
// we don't ship a templating engine for two emails — easy to fork later
// if the catalog grows. All HTML is inline-styled because Gmail/Outlook
// strip <style> blocks aggressively.
//
// Configure with:
//   RESEND_API_KEY      — required, sender will silently no-op without
//   RESEND_FROM_EMAIL   — "Display Name <email@domain>" format; sandbox
//                         onboarding@resend.dev works for testing
//   APP_BASE_URL        — used in reset links

import { Resend } from 'resend'

let cachedClient = null
function getClient() {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  if (!cachedClient) cachedClient = new Resend(key)
  return cachedClient
}

function getFromAddress() {
  return process.env.RESEND_FROM_EMAIL || 'pokerxyz <onboarding@resend.dev>'
}

// App palette mirrored from globals.css so the email reads like part of
// the product. Pure inline because email clients ignore <style> blocks.
const COLOR = {
  bg:       '#09090b',   // zinc-950
  card:     '#18181b',   // zinc-900
  border:   '#3f3f46',   // zinc-700
  textDim:  '#a1a1aa',   // zinc-400
  text:     '#fafafa',   // zinc-50
  accent:   '#fbbf24',   // amber-400
  accentBg: 'rgba(251,191,36,0.12)'
}

// Wraps any body block in a centered, dark, mobile-friendly shell.
// Width=520 reads cleanly on phones (clients downscale) and desktop
// (mirrors how Twitter/GitHub/Linear emails sit on the page).
function shell({ title, preheader, body }) {
  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${preheader}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLOR.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px;background:${COLOR.card};border:1px solid ${COLOR.border};border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:24px 28px 8px;">
              <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.18em;color:${COLOR.accent};">
                pokerxyz
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;color:${COLOR.text};">
              ${body}
            </td>
          </tr>
        </table>
        <div style="margin-top:16px;font-size:11px;color:${COLOR.textDim};">
          You're getting this because someone used this address to sign in on pokerxyz.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()
}

// Big-numbers code block — the visual centerpiece of the verify email.
// We render each digit in its own cell so it reads on both Outlook
// (which mangles letter-spacing) and Apple Mail (which doesn't).
function codeBlock(code) {
  const digits = String(code).split('')
  const cells = digits.map(d => `
    <td style="padding:0 4px;">
      <div style="width:42px;height:54px;line-height:54px;border:1px solid ${COLOR.border};border-radius:8px;background:${COLOR.accentBg};color:${COLOR.accent};font-size:28px;font-weight:900;text-align:center;letter-spacing:0;">${d}</div>
    </td>
  `).join('')
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:20px auto;">
      <tr>${cells}</tr>
    </table>`
}

function buttonLink(url, label) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:20px auto;">
      <tr>
        <td style="border-radius:8px;background:${COLOR.accent};">
          <a href="${url}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:800;color:#111827;text-decoration:none;letter-spacing:0.02em;">${label}</a>
        </td>
      </tr>
    </table>`
}

export function renderSignupVerifyEmail({ code, ttlMinutes, displayName }) {
  const body = `
    <div style="font-size:20px;font-weight:800;color:${COLOR.text};margin-bottom:6px;">Welcome${displayName ? `, ${displayName}` : ''}.</div>
    <div style="font-size:14px;line-height:1.5;color:${COLOR.textDim};">
      Use this code to finish signing in. It expires in ${ttlMinutes} minutes.
    </div>
    ${codeBlock(code)}
    <div style="font-size:12px;color:${COLOR.textDim};line-height:1.5;">
      If you didn't sign up, you can ignore this email — no account is created until you verify.
    </div>
  `
  return {
    subject: 'Verify your pokerxyz email',
    html: shell({ title: 'Verify your email', preheader: `Your verification code: ${code}`, body }),
    text: `Your pokerxyz verification code is ${code}. It expires in ${ttlMinutes} minutes.\n\nIf you didn't sign up, ignore this email.`
  }
}

export function renderPasswordResetEmail({ code, ttlMinutes, displayName }) {
  const body = `
    <div style="font-size:20px;font-weight:800;color:${COLOR.text};margin-bottom:6px;">Reset your password</div>
    <div style="font-size:14px;line-height:1.5;color:${COLOR.textDim};">
      ${displayName ? `Hi ${displayName} — t` : 'T'}his code lets you set a new password. It expires in ${ttlMinutes} minutes.
    </div>
    ${codeBlock(code)}
    <div style="font-size:12px;color:${COLOR.textDim};line-height:1.5;">
      Didn't request this? Your account is safe — just ignore this email. Whoever sent the request won't see anything.
    </div>
  `
  return {
    subject: 'Reset your pokerxyz password',
    html: shell({ title: 'Reset your password', preheader: `Your reset code: ${code}`, body }),
    text: `Your pokerxyz password reset code is ${code}. It expires in ${ttlMinutes} minutes.\n\nIf you didn't request this, ignore this email.`
  }
}

// Top-level send. Returns { ok, providerId } on success or { ok: false,
// error } on a graceful failure. Logs but never throws — caller decides
// whether a missing email subsystem should bubble up as a 500.
export async function sendEmail({ to, subject, html, text }) {
  const client = getClient()
  if (!client) {
    console.warn('[email] RESEND_API_KEY not set; skipping send to', to)
    return { ok: false, error: 'email_disabled' }
  }
  try {
    const result = await client.emails.send({
      from: getFromAddress(),
      to,
      subject,
      html,
      text
    })
    if (result.error) {
      console.error('[email] send failed:', result.error)
      return { ok: false, error: result.error.message || 'send_failed' }
    }
    return { ok: true, providerId: result.data?.id || null }
  } catch (err) {
    console.error('[email] threw:', err.message)
    return { ok: false, error: err.message }
  }
}

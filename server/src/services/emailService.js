const Mailgun = require('mailgun.js');
const FormData = require('form-data');

const APP_URL = process.env.APP_URL || 'https://himaxym.com';
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const MAILGUN_FROM = process.env.MAILGUN_FROM || `FlightFinder <noreply@${MAILGUN_DOMAIN}>`;

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
      throw new Error('Mailgun not configured: set MAILGUN_API_KEY and MAILGUN_DOMAIN');
    }
    const mailgun = new Mailgun(FormData);
    _client = mailgun.client({ username: 'api', key: process.env.MAILGUN_API_KEY });
  }
  return _client;
}

function verificationEmailHtml(verifyUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
        <tr>
          <td style="background:#0f172a;padding:32px 40px;text-align:center">
            <span style="font-size:28px">✈</span>
            <span style="color:#fff;font-size:20px;font-weight:bold;margin-left:10px;vertical-align:middle">FlightFinder</span>
          </td>
        </tr>
        <tr>
          <td style="padding:40px">
            <h1 style="margin:0 0 16px;font-size:22px;color:#0f172a">Confirm your email address</h1>
            <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6">
              Thanks for signing up! Click the button below to verify your email and activate your account.
            </p>
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:8px;background:#2563eb">
                  <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;color:#fff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px">
                    Verify email address
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;color:#94a3b8;font-size:13px;line-height:1.5">
              This link expires in <strong>24 hours</strong>. If you didn't create a FlightFinder account, you can safely ignore this email.
            </p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0">
            <p style="margin:0;color:#94a3b8;font-size:12px">
              Can't click the button? Copy and paste this link:<br>
              <a href="${verifyUrl}" style="color:#2563eb;word-break:break-all">${verifyUrl}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;background:#f8fafc;text-align:center">
            <p style="margin:0;color:#94a3b8;font-size:12px">&copy; ${new Date().getFullYear()} FlightFinder. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendVerificationEmail(email, token) {
  const verifyUrl = `${APP_URL}/?action=verify&token=${token}`;
  return getClient().messages.create(MAILGUN_DOMAIN, {
    from: MAILGUN_FROM,
    to: email,
    subject: 'Confirm your FlightFinder account',
    text: [
      'Welcome to FlightFinder!',
      '',
      'Please confirm your email address by visiting the link below:',
      '',
      verifyUrl,
      '',
      'This link expires in 24 hours.',
      '',
      "If you didn't create an account, you can ignore this email.",
    ].join('\n'),
    html: verificationEmailHtml(verifyUrl),
  });
}

module.exports = { sendVerificationEmail };

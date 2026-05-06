import Handlebars from "handlebars";
import { EMAIL_COLORS } from "../email-colors";

export function buildPasswordResetEmailHtml(resetUrl: string): string {
	const safeResetUrl = Handlebars.Utils.escapeExpression(resetUrl);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reset your password — Readplace</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.background};font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_COLORS.background};padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_COLORS.surface};border-radius:8px;padding:40px;">
<tr><td>
<h1 style="margin:0 0 16px;font-size:24px;color:${EMAIL_COLORS.heading};">Reset your password</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:${EMAIL_COLORS.body};">Click the button below to set a new password for your Readplace account. This link expires in one hour.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background-color:${EMAIL_COLORS.brand};">
<a href="${safeResetUrl}" style="display:inline-block;padding:12px 24px;font-size:16px;color:${EMAIL_COLORS.brandText};text-decoration:none;border-radius:6px;">Reset password</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:${EMAIL_COLORS.muted};">If you didn't request a password reset, you can ignore this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

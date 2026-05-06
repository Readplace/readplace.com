import Handlebars from "handlebars";
import { EMAIL_COLORS } from "../../email-colors";

export function buildUserDataExportEmailHtml(params: {
	downloadUrl: string;
	articleCount: number;
	ttlDays: number;
}): string {
	const { downloadUrl, articleCount, ttlDays } = params;
	const safeDownloadUrl = Handlebars.Utils.escapeExpression(downloadUrl);
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Readplace export is ready</title>
</head>
<body style="margin:0;padding:0;background-color:${EMAIL_COLORS.background};font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_COLORS.background};padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_COLORS.surface};border-radius:8px;padding:40px;">
<tr><td>
<h1 style="margin:0 0 16px;font-size:24px;color:${EMAIL_COLORS.heading};">Your export is ready</h1>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:${EMAIL_COLORS.body};">We've packaged ${articleCount} article${articleCount === 1 ? "" : "s"} as a single JSON file. Click the button below to download it. The link expires in ${ttlDays} days.</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background-color:${EMAIL_COLORS.brand};">
<a href="${safeDownloadUrl}" style="display:inline-block;padding:12px 24px;font-size:16px;color:${EMAIL_COLORS.brandText};text-decoration:none;border-radius:6px;">Download my data</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:${EMAIL_COLORS.muted};">If the button above doesn't work, copy and paste this URL into your browser:<br><span style="word-break:break-all;">${safeDownloadUrl}</span></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

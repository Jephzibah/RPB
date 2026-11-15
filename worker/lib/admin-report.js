import site from '../../site.config.js';
import { HttpError, json, readJson, clean, emailList } from './http.js';
import { requireAdmin } from './access.js';
import { sendEmail } from './email.js';

// "Send to support" on an admin error: emails the details to SUPPORT_EMAIL (else the first provider, else CONTACT_TO)
export async function adminReportError(request, env) {
	const actor = await requireAdmin(request, env);
	const body = await readJson(request);
	const details = clean(typeof body.details === 'string' ? body.details : JSON.stringify(body.details, null, 2), 8000);
	if (!details) throw new HttpError(400, 'Nothing to report.');
	const note = clean(body.note, 2000);
	const page = clean(body.page, 500);
	const to = env.SUPPORT_EMAIL || emailList(env.PROVIDER_EMAILS)[0] || env.CONTACT_TO;

	await sendEmail(env, {
		to,
		replyTo: actor.email,
		subject: `[${site.name} admin] Error report from ${actor.email}`,
		text: `${actor.email} (${actor.role}) reported an error in the ${site.name} admin.\n\nPage: ${page || '-'}\n${note ? `Note: ${note}\n` : ''}\n${details}\n`,
	});
	return json({ ok: true, to });
}

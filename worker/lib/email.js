import { EmailMessage } from 'cloudflare:email';

/**
 * Sends a plain-text email. Transport is picked from the environment:
 *   1. RESEND_API_KEY  → Resend API (any recipient)
 *   2. SEND_EMAIL      → Cloudflare Email Routing binding (recipient must be a verified address)
 *   3. EMAIL_DEV_LOG=1 → just logs it (local development)
 * User input never goes into headers except a validated Reply-To.
 */
export async function sendEmail(env, { to, subject, text, replyTo }) {
	const from = env.EMAIL_FROM;
	const fromName = env.EMAIL_FROM_NAME || 'Website';

	if (env.RESEND_API_KEY) {
		const response = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ from: `${fromName} <${from}>`, to: [to], subject, text, reply_to: replyTo || undefined }),
		});
		if (!response.ok) throw new Error(`Resend failed: ${response.status} ${await response.text()}`);
		return;
	}

	if (env.SEND_EMAIL) {
		const raw = buildMime({ from, fromName, to, subject, text, replyTo });
		await env.SEND_EMAIL.send(new EmailMessage(from, to, raw));
		return;
	}

	if (env.EMAIL_DEV_LOG) {
		console.log(`--- email (dev log) ---\nTo: ${to}\nReply-To: ${replyTo || ''}\nSubject: ${subject}\n\n${text}\n---`);
		return;
	}

	throw new Error('No email transport configured (set RESEND_API_KEY or the SEND_EMAIL binding)');
}

const oneLine = (value) => String(value).replace(/[\r\n]+/g, ' ').trim();

function base64(str) {
	const bytes = new TextEncoder().encode(str);
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

// RFC 2047 encoded-word for non-ASCII header text
const encodeHeader = (value) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64(value)}?=`);

function buildMime({ from, fromName, to, subject, text, replyTo }) {
	const domain = from.split('@')[1];
	return [
		`From: ${encodeHeader(oneLine(fromName))} <${from}>`,
		`To: <${to}>`,
		replyTo ? `Reply-To: <${oneLine(replyTo)}>` : null,
		`Subject: ${encodeHeader(oneLine(subject))}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <${crypto.randomUUID()}@${domain}>`,
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=UTF-8',
		'Content-Transfer-Encoding: base64',
		'',
		base64(text).replace(/.{76}/g, '$&\r\n'),
	]
		.filter((line) => line !== null)
		.join('\r\n');
}

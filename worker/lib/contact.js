import { HttpError, json, requireFeature, requireEnv, clean, isEmail } from './http.js';
import { verifyTurnstile } from './turnstile.js';
import { sendEmail } from './email.js';

export async function handleContact(request, env) {
	requireFeature('contact');
	requireEnv(env, 'TURNSTILE_SECRET', 'CONTACT_TO', 'EMAIL_FROM');

	if (Number(request.headers.get('Content-Length')) > 65_536) throw new HttpError(413, 'Message too large.');
	const form = await request.formData();

	// Honeypot: bots fill every field. Pretend success so they don't retry.
	if (form.get('company_website')) return json({ message: 'Thanks! Your message has been sent.' });

	const human = await verifyTurnstile(form.get('cf-turnstile-response'), request.headers.get('CF-Connecting-IP'), env.TURNSTILE_SECRET);
	if (!human) throw new HttpError(403, 'Spam check failed.');

	const name = clean(form.get('name'), 100);
	const email = clean(form.get('email'), 200);
	const phone = clean(form.get('phone'), 40);
	const subject = clean(form.get('subject'), 150);
	const message = clean(form.get('message'), 5000);

	if (!name || !subject || !message || !isEmail(email)) throw new HttpError(400, 'Please complete all required fields.');

	await sendEmail(env, {
		to: env.CONTACT_TO,
		replyTo: email,
		subject: `Website contact: ${subject}`,
		text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || '-'}\nSubject: ${subject}\n\n${message}\n`,
	});

	return json({ message: 'Thanks! Your message has been sent.' });
}

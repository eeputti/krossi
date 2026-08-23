import { Resend } from 'resend';

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey || apiKey === 're_xxxxxxxxx') {
  throw new Error(
    'Replace re_xxxxxxxxx in .env.local with your real Resend API key.',
  );
}

const resend = new Resend(apiKey);

const { data, error } = await resend.emails.send({
  from: 'Krossi <messages@krossi.app>',
  to: 'eelispuro@gmail.com',
  subject: 'Krossi sähköpostitesti',
  html: '<p>Krossin sähköpostilähetys toimii osoitteesta <strong>messages@krossi.app</strong>.</p>',
});

if (error) {
  throw new Error(`Resend could not send the email: ${error.message}`);
}

console.log(`Email sent successfully (${data.id}).`);

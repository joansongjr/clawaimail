import nodemailer from 'nodemailer';

const PROVIDER = process.env.MAIL_PROVIDER || 'smtp';

function createTransporter() {
  switch (PROVIDER) {
    case 'resend':
      // Resend uses SMTP interface
      return nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        auth: {
          user: 'resend',
          pass: process.env.RESEND_API_KEY
        }
      });

    case 'ses':
      // Amazon SES SMTP interface
      return nodemailer.createTransport({
        host: process.env.SES_SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com',
        port: 465,
        secure: true,
        auth: {
          user: process.env.SES_SMTP_USER,
          pass: process.env.SES_SMTP_PASS
        }
      });

    case 'smtp':
    default:
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_SEND_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        } : undefined
      });
  }
}

const transporter = createTransporter();

export async function sendEmail({ to, subject, text, html, from }) {
  const result = await transporter.sendMail({
    from: from || process.env.SERVER_EMAIL || `noreply@${process.env.MAIL_DOMAIN || 'clawaimail.com'}`,
    to,
    subject,
    text,
    html
  });
  console.log(`[Mailer] Sent to ${to}: "${subject}" via ${PROVIDER}`);
  return {
    messageId: result.messageId,
    accepted: result.accepted,
    rejected: result.rejected
  };
}

export async function testConnection() {
  try {
    await transporter.verify();
    console.log(`[Mailer] ${PROVIDER} connection OK`);
    return true;
  } catch (err) {
    console.error(`[Mailer] ${PROVIDER} connection failed:`, err.message);
    return false;
  }
}

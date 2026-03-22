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

const MAX_ATTACHMENT_SIZE = parseInt(process.env.MAX_ATTACHMENT_SIZE || '5242880'); // 5MB default
const MAX_TOTAL_ATTACHMENTS_SIZE = parseInt(process.env.MAX_TOTAL_ATTACHMENTS_SIZE || '10485760'); // 10MB total

export async function sendEmail({ to, subject, text, html, from, attachments }) {
  // Validate attachments if provided
  let mailAttachments;
  if (attachments && Array.isArray(attachments) && attachments.length > 0) {
    let totalSize = 0;
    mailAttachments = attachments.map((att, i) => {
      if (!att.filename) throw new Error(`Attachment ${i} missing filename`);
      if (!att.content) throw new Error(`Attachment ${i} missing content (base64)`);
      const buf = Buffer.from(att.content, 'base64');
      if (buf.length > MAX_ATTACHMENT_SIZE) {
        throw new Error(`Attachment "${att.filename}" exceeds ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB limit`);
      }
      totalSize += buf.length;
      if (totalSize > MAX_TOTAL_ATTACHMENTS_SIZE) {
        throw new Error(`Total attachments exceed ${MAX_TOTAL_ATTACHMENTS_SIZE / 1024 / 1024}MB limit`);
      }
      return {
        filename: att.filename,
        content: buf,
        contentType: att.content_type || 'application/octet-stream'
      };
    });
  }

  const result = await transporter.sendMail({
    from: from || process.env.SERVER_EMAIL || `noreply@${process.env.MAIL_DOMAIN || 'clawaimail.com'}`,
    to,
    subject,
    text,
    html,
    attachments: mailAttachments
  });
  console.log(`[Mailer] Sent to ${to}: "${subject}" via ${PROVIDER}${mailAttachments ? ` (${mailAttachments.length} attachments)` : ''}`);
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

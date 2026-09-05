import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import config from '../config';
import { errorLogger, logger } from '../shared/logger';
import { ISendEmail } from '../types/email';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: Number(config.email.port),
  secure: Number(config.email.port) === 465,
  requireTLS: Number(config.email.port) !== 465,
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

const sendEmail = async (values: ISendEmail) => {
  try {
    const info = await transporter.sendMail({
      from: `"${config.branding.projectName}" <${config.email.from}>`,
      to: values.to,
      subject: values.subject,
      text: values.text,
      html: values.html,
      envelope: {
        from: config.email.from,
        to: values.to,
      },
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Entity-Ref-ID': crypto.randomUUID(),
      },
    });

    logger.info('Mail send successfully', info.accepted);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorLogger.error(`Email delivery failed: ${message}`);
    throw error;
  }
};

export const emailHelper = {
  sendEmail,
};

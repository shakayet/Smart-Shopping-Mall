import nodemailer from 'nodemailer';
import config from '../config';
import { errorLogger, logger } from '../shared/logger';
import { ISendEmail } from '../types/email';

const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: Number(config.email.port),
  secure: Number(config.email.port) === 465,
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
      html: values.html,
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

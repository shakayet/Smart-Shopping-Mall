export type ISendEmail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

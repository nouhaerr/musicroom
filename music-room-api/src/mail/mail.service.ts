import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly appUrl: string;
  private readonly from: string;
  private readonly transporter?: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(private readonly config: ConfigService) {
    this.appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000').replace(/\/$/, '');
    const url = new URL(this.appUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('APP_URL doit être une URL HTTP(S) sans identifiants, query ni fragment');
    }
    this.from = this.config.get<string>('MAIL_FROM', '').trim();
    const mode = this.config.get<string>('MAIL_TRANSPORT', 'log');
    if (mode === 'log') {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new Error('MAIL_TRANSPORT=smtp est requis en production');
      }
      return;
    }
    if (mode !== 'smtp') throw new Error('MAIL_TRANSPORT doit valoir log ou smtp');

    const host = this.config.get<string>('MAIL_HOST', '').trim();
    const user = this.config.get<string>('MAIL_USER', '').trim();
    const pass = this.config.get<string>('MAIL_PASSWORD', '');
    if (!host || !user || !pass.trim() || !this.from) {
      throw new Error('SMTP : MAIL_HOST, MAIL_USER, MAIL_PASSWORD et MAIL_FROM sont requis');
    }
    const port = Number(this.config.get<string>('MAIL_PORT', '587'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('MAIL_PORT doit être un entier entre 1 et 65535');
    }
    const secure = this.config.get<string>('MAIL_SECURE', port === 465 ? 'true' : 'false');
    if (!['true', 'false'].includes(secure)) throw new Error('MAIL_SECURE doit valoir true ou false');
    if ((port === 465 && secure !== 'true') || (port === 587 && secure !== 'false')) {
      throw new Error('SMTP : utiliser MAIL_SECURE=true sur 465, false sur 587 (STARTTLS)');
    }
    this.transporter = createTransport({
      host, port, secure: secure === 'true',
      requireTLS: true,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      dnsTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const link = this.link('verify-email', token);
    await this.send(email, 'SONORA — Vérifiez votre adresse email',
      'Confirmez votre adresse email pour activer votre compte Sonora. Ce lien expire dans 24 heures.', link);
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const link = this.link('reset-password', token);
    await this.send(email, 'SONORA — Réinitialisation du mot de passe',
      'Vous avez demandé un nouveau mot de passe. Ce lien expire dans 30 minutes et ne peut être utilisé qu’une fois. Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.', link);
  }

  // Diagnostic Gmail : envoie uniquement à l'adresse SMTP configurée.
  async sendTestEmail(): Promise<void> {
    if (!this.transporter) throw new Error('Configurer MAIL_TRANSPORT=smtp pour envoyer un test');
    const email = this.config.get<string>('MAIL_USER', '').trim();
    await this.send(email, 'SONORA — Test SMTP',
      'Ceci est un email de test envoyé par votre backend Sonora. Si vous le recevez, votre configuration SMTP fonctionne.', this.appUrl);
  }

  // Vérifie la connexion et les identifiants, sans envoyer de message.
  async verifyConnection(): Promise<void> {
    if (!this.transporter) throw new Error('Configurer MAIL_TRANSPORT=smtp pour vérifier la connexion');
    try {
      await this.transporter.verify();
    } catch (error) {
      this.fail(error);
    }
  }

  private link(path: string, token: string): string {
    const url = new URL(`${this.appUrl}/auth/${path}`);
    url.searchParams.set('token', token);
    return url.href;
  }

  private async send(to: string, subject: string, message: string, link: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[DEV] ${subject} pour ${to} : ${link}`);
      return;
    }
    try {
      const result = await this.transporter.sendMail({
        from: this.from,
        to: { address: to, name: '' },
        subject,
        text: `${message}\n\n${link}\n\nL’équipe SONORA`,
        html: `<p>${escapeHtml(message)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(subject)}</a></p><p>L’équipe Sonora</p>`,
      });
      if (!result.accepted.length || result.rejected.length) throw new Error('Recipient rejected');
      this.logger.log('Email accepté par le serveur SMTP');
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): never {
    // Les réponses SMTP brutes peuvent contenir des adresses ou des secrets.
    const code = (error as { code?: unknown } | null)?.code;
    const safeCode = typeof code === 'string' && ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EENVELOPE', 'EMESSAGE', 'EDNS', 'ETLS'].includes(code)
      ? code : 'SMTP_ERROR';
    this.logger.error(`Échec SMTP (${safeCode}) : vérifier la configuration ou réessayer plus tard`);
    throw new ServiceUnavailableException('Envoi des emails temporairement indisponible');
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

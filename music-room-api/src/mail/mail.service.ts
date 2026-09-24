import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Implémentation minimale : logue les liens dans la console.
// À remplacer par un vrai transport (ex: nodemailer + SMTP, ou un provider
// comme Sendgrid/Mailgun) une fois MAIL_HOST/MAIL_USER/MAIL_PASSWORD renseignés.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    this.appUrl = this.config.get<string>('APP_URL', 'http://localhost:3000');
  }

  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const link = `${this.appUrl}/auth/verify-email?token=${token}`;
    this.logger.log(`[DEV] Email de vérification pour ${email} : ${link}`);
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const link = `${this.appUrl}/auth/reset-password?token=${token}`;
    this.logger.log(`[DEV] Email de réinitialisation pour ${email} : ${link}`);
  }
}

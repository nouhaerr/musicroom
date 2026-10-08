import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MailModule } from '../src/mail/mail.module';
import { MailService } from '../src/mail/mail.service';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), MailModule] })
class SmtpCheckModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(SmtpCheckModule, { logger: false, abortOnError: false });
  try {
    await app.get(MailService).verifyConnection();
    if (process.argv.includes('--send-test')) {
      await app.get(MailService).sendTestEmail();
      console.log('Email de test accepté par SMTP pour MAIL_USER. Vérifiez votre boîte de réception et les spams.');
    } else {
      console.log('Connexion SMTP et authentification réussies. Aucun email envoyé.');
    }
  } finally {
    await app.close();
  }
}

main().catch(() => {
  console.error('Vérification SMTP échouée. Vérifier MAIL_TRANSPORT, les paramètres SMTP, le mot de passe d’application et la connexion réseau.');
  process.exitCode = 1;
});

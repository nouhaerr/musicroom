import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Toutes les entrées de l'API sont validées/nettoyées via les DTO (class-validator)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // retire les champs non déclarés dans le DTO
      forbidNonWhitelisted: true, // rejette la requête si un champ inconnu est envoyé
      transform: true, // convertit automatiquement les payloads vers les types des DTO
    }),
  );

  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Music Room API')
    .setDescription([
      'REST API of Music Room. Request and answer bodies are JSON, except the two email links, which answer an HTML page.',
      '',
      'Sign in with `POST /auth/login` (or Facebook, Google), then send `Authorization: Bearer <accessToken>`.',
      '',
      'An error is JSON too, with the status and a message: `{ "statusCode": 404, "message": "Party not found", "error": "Not Found" }`',
      '(`error` can be missing).',
      '- 400: invalid input; for invalid fields, `message` is the list of what is wrong',
      '- 401: not signed in, or the session ended',
      '- 403: not allowed (not the owner, not invited...)',
      '- 404: not found',
      '- 409: refused by the current state (already voted, queue full, changed by someone else meanwhile: read it again)',
      '- 429: too many requests, try again in a minute',
      '',
      'Live updates of rooms and playlists come through a WebSocket connection, not these routes:',
      'see the README section "Temps réel (WebSocket)".',
    ].join('\n'))
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Music Room API listening on http://localhost:${port}`);
  console.log(`Swagger docs on http://localhost:${port}/docs`);
}
bootstrap();

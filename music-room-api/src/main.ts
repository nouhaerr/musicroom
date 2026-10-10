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
    .setDescription('API REST du projet Music Room (auth, users, ...)')
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

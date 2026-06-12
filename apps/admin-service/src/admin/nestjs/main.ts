import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { loadBackendEnv } from './config/load-env';

async function bootstrap() {
  loadBackendEnv();

  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PAKISHIP_BACKEND_PORT ?? process.env.PORT ?? 4000);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.PAKISHIP_FRONTEND_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(port);
  console.log(`PakiShip backend running on http://localhost:${port}/api`);
}

void bootstrap();

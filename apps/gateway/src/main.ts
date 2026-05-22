import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AllExceptionsFilter,
  BODY_SIZE_LIMIT,
  corsOptions,
  helmetConfig,
} from '@app/common';
import * as express from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  const configService = app.get(ConfigService);

  app.use(helmet(helmetConfig));
  app.use(express.json({ limit: BODY_SIZE_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_SIZE_LIMIT }));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');

  const allowedOriginsEnv = configService.get<string>('ALLOWED_ORIGINS');
  app.enableCors(corsOptions(allowedOriginsEnv));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const port = configService.get<number>('PORT') ?? 3005;
  await app.listen(port, '0.0.0.0');
  logger.log(`Gateway running on 0.0.0.0:${String(port)}`);
}

void bootstrap();

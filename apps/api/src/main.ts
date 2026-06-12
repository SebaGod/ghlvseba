import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  app.use(
    helmet({
      // HSTS over plain http in dev would pin browsers to https for a year
      strictTransportSecurity: env.NODE_ENV === 'production',
    }),
  );
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_URL, credentials: true });
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/liveness', 'health/readiness'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Platform API')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(env.API_PORT);
}

void bootstrap();

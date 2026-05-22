import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware } from 'http-proxy-middleware';

@Module({})
export class GatewayModule implements NestModule {
  constructor(private readonly configService: ConfigService) {}

  configure(consumer: MiddlewareConsumer) {
    const pakishipUrl = this.configService.get<string>('PAKISHIP_URL', 'http://localhost:3001');
    const pakiparkUrl = this.configService.get<string>('PAKIPARK_URL', 'http://localhost:3002');

    // ==========================================
    // 1. pakiSHIP MICROSERVICE (Port: 3001)
    // ==========================================
    consumer
      .apply(
        createProxyMiddleware({
          target: pakishipUrl,
          changeOrigin: true,
          pathRewrite: { '^/api/ship': '' },
        }),
      )
      .forRoutes('/api/ship');

    // ==========================================
    // 2. pakiPARK MICROSERVICE (Port: 3002)
    // ==========================================
    consumer
      .apply(
        createProxyMiddleware({
          target: pakiparkUrl,
          changeOrigin: true,
          pathRewrite: { '^/api/park': '' },
        }),
      )
      .forRoutes('/api/park');
  }
}

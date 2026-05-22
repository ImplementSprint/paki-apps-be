import { CallHandler, ExecutionContext, Injectable, NestInterceptor, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import Redis from 'ioredis';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private redisClient: Redis;

  constructor(private readonly configService: ConfigService) {
    this.redisClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
    });
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['x-idempotency-key'];

    if (!idempotencyKey || !['POST', 'PUT', 'PATCH'].includes(request.method)) {
      return next.handle();
    }

    const redisKey = `idempotency:${idempotencyKey}`;

    const isLockAcquired = await this.redisClient.set(`lock:${idempotencyKey}`, 'LOCKED', 'EX', 30, 'NX');
    const cachedResponse = await this.redisClient.get(redisKey);
    if (cachedResponse) {
      await this.redisClient.del(`lock:${idempotencyKey}`);
      return of(JSON.parse(cachedResponse));
    }

    if (!isLockAcquired) {
      throw new HttpException('Request is already being processed. Please wait.', HttpStatus.CONFLICT);
    }

    return next.handle().pipe(
      tap(async (responseData) => {
        try {
          await this.redisClient.set(redisKey, JSON.stringify(responseData), 'EX', 86400);
        } finally {
          await this.redisClient.del(`lock:${idempotencyKey}`);
        }
      }),
    );
  }
}

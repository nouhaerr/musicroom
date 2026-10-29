import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ActionLogMiddleware } from './action-log.middleware';

@Module({ providers: [ActionLogMiddleware] })
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ActionLogMiddleware).forRoutes('{*path}');
  }
}

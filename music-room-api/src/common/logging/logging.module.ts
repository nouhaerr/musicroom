import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActionLogInterceptor } from './action-log.interceptor';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: ActionLogInterceptor }],
})
export class LoggingModule {}

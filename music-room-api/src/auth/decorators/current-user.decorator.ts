import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { PublicUser } from '../../users/user.mapper';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

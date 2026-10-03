import { ExecutionContext, Injectable, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LoginDto } from '../dto/login.dto';

@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {
  private readonly validation = new ValidationPipe({
    whitelist: true, forbidNonWhitelisted: true, transform: true,
  });

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Guards run before controller pipes, so validate before Passport reads the body.
    const request = context.switchToHttp().getRequest();
    request.body = await this.validation.transform(request.body, { type: 'body', metatype: LoginDto });
    return super.canActivate(context) as Promise<boolean>;
  }
}

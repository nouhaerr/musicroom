import { ValidationPipe } from '@nestjs/common';
import { RegisterDto } from './register.dto';
import { ResetPasswordDto } from './misc.dto';
import { LoginDto } from './login.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

describe.each([
  { metatype: RegisterDto, field: 'password', other: { email: 'test@example.com', name: 'Test' } },
  { metatype: ResetPasswordDto, field: 'newPassword', other: { token: 'test-token' } },
])('New password validation for $field', ({ metatype, field, other }) => {
  it.each(['', 'abcdef1', 'abcdefgh', 'abcdefg１', 'abcdefg١', '😀😀😀😀😀😀1'])('rejects %j', async password => {
    await expect(pipe.transform({ ...other, [field]: password }, { type: 'body', metatype })).rejects.toMatchObject({ status: 400 });
  });
  it.each(['abcdefg1', '1abcdefg', 'abcd1efg', '😀😀😀😀😀😀😀1'])('accepts %j', async password => {
    await expect(pipe.transform({ ...other, [field]: password }, { type: 'body', metatype })).resolves.toHaveProperty(field, password);
  });
});

it('still lets existing passwords without numbers reach login authentication', async () => {
  await expect(pipe.transform({ email: 'test@example.com', password: 'legacy-password' }, { type: 'body', metatype: LoginDto }))
    .resolves.toHaveProperty('password', 'legacy-password');
});

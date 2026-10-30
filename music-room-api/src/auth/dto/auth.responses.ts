import { ApiProperty } from '@nestjs/swagger';
import { AccountResponse } from '../../users/dto/user.responses';

// A signed-in session: send accessToken as "Authorization: Bearer <accessToken>", and refreshToken to POST /auth/refresh
// when it expires
export class SessionResponse {
  @ApiProperty({ type: AccountResponse })
  user!: AccountResponse;

  @ApiProperty({ description: 'Short-lived (JWT_ACCESS_EXPIRES_IN, 15 minutes by default)' })
  accessToken!: string;

  @ApiProperty({ description: 'Long-lived (JWT_REFRESH_EXPIRES_IN, 7 days by default); a new one comes with each refresh' })
  refreshToken!: string;
}

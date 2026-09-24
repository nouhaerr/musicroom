export type TokenType = 'access' | 'refresh' | 'email-verification' | 'password-reset';

export interface JwtPayload {
  sub: string; // userId
  email: string;
  type: TokenType;
}
